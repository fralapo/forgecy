import type { SourceFailure } from "../types";

export type BreakerStatus = "closed" | "open" | "half-open";

export interface BreakerState {
  status: BreakerStatus;
  openedAt: number | null;
  /** The failure that opened the breaker. */
  reason: SourceFailure | null;
  consecutiveFailures: number;
  /** api_drift responses seen; they never open the breaker. */
  driftCount: number;
}

export interface CircuitBreakerConfig {
  /** Consecutive transport failures that open the breaker. */
  failureThreshold: number;
  openMs: number;
  now?: () => number;
}

export interface CircuitBreaker {
  canRun(): boolean;
  onSuccess(): void;
  onFailure(failure: SourceFailure): void;
  state(): BreakerState;
  /** A person clears a blocked/unauthorized trip. */
  reset(): void;
}

export function createCircuitBreaker(cfg: CircuitBreakerConfig): CircuitBreaker {
  const now = cfg.now ?? Date.now;
  let status: BreakerStatus = "closed";
  let openedAt: number | null = null;
  let reason: SourceFailure | null = null;
  let consecutive = 0;
  let drift = 0;

  const open = (why: SourceFailure): void => {
    status = "open";
    openedAt = now();
    reason = why;
  };
  const close = (): void => {
    status = "closed";
    openedAt = null;
    reason = null;
    consecutive = 0;
  };

  return {
    canRun() {
      if (status === "closed") return true;
      // After a challenge we stop everything until a person resets.
      if (status === "half-open" || reason === "blocked") return false;
      if (now() - (openedAt ?? 0) < cfg.openMs) return false;
      status = "half-open";
      return true;
    },
    onSuccess() {
      if (status === "open") return; // late result of a request started before the trip
      close();
    },
    onFailure(failure) {
      if (failure === "blocked" || failure === "unauthorized") return open(failure);
      if (status === "half-open") {
        // Only a failed trial keeps it open; any real answer from the server closes it.
        if (failure === "transport" || failure === "rate_limited") return open(failure);
        return close();
      }
      if (failure === "api_drift") drift++;
      if (failure !== "transport" || status === "open") return;
      consecutive++;
      if (consecutive >= cfg.failureThreshold) open("transport");
    },
    state: () => ({
      status,
      openedAt,
      reason,
      consecutiveFailures: consecutive,
      driftCount: drift,
    }),
    reset() {
      close();
    },
  };
}
