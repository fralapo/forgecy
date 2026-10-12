import { SourceError } from "../types";
import type { RequestGuard, SourceFailure } from "../types";
import type { CircuitBreaker } from "./breaker";
import type { RateController } from "./rate-controller";

export interface GuardEvent {
  kind: "request" | "retry" | "tripped" | "budget";
  bucket: string;
  failure?: SourceFailure;
  attempt?: number;
}

export interface GuardConfig {
  rate: RateController;
  breaker: CircuitBreaker;
  /** Hard cap of requests (retries included) for one guard. */
  maxRequests: number;
  /** Total tries per run(), default 3. */
  maxAttempts?: number;
  onEvent?: (event: GuardEvent) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type Guard = RequestGuard & { used(): number; reset(): void };

/** After a 429 wait at least this long, whatever the header says, and never more than the cap. */
const MIN_RATE_LIMIT_WAIT_MS = 30_000;
const MAX_RATE_LIMIT_WAIT_MS = 15 * 60_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toSourceError = (e: unknown): SourceError =>
  e instanceof SourceError
    ? e
    : new SourceError("transport", e instanceof Error ? e.message : String(e));

export function createGuard(cfg: GuardConfig): Guard {
  const { rate, breaker } = cfg;
  const maxAttempts = cfg.maxAttempts ?? 3;
  const sleep = cfg.sleep ?? defaultSleep;
  const emit = (event: GuardEvent): void => cfg.onEvent?.(event);
  let used = 0;

  return {
    used: () => used,
    reset() {
      used = 0;
      breaker.reset();
    },
    async run<T>(bucket: string, fn: () => Promise<T>): Promise<T> {
      let last: SourceError | null = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // On a retry, the error that got us here is more useful than "circuit open".
        if (!breaker.canRun()) {
          if (last) throw last;
          const blocked = breaker.state().reason === "blocked";
          throw new SourceError(blocked ? "blocked" : "transport", "circuit open");
        }
        if (used >= cfg.maxRequests) {
          emit({ kind: "budget", bucket });
          throw last ?? new SourceError("rate_limited", "request budget exhausted");
        }
        await rate.acquire(bucket);
        used++;
        emit({ kind: "request", bucket, attempt });
        try {
          const value = await fn();
          breaker.onSuccess();
          return value;
        } catch (e) {
          const err = toSourceError(e);
          last = err;
          const before = breaker.state().status;
          breaker.onFailure(err.failure);
          if (before !== "open" && breaker.state().status === "open") {
            emit({ kind: "tripped", bucket, failure: err.failure });
          }
          const retryable = err.failure === "rate_limited" || err.failure === "transport";
          if (!retryable || attempt >= maxAttempts) throw err;
          const delay =
            err.failure === "rate_limited"
              ? Math.min(
                  Math.max(err.retryAfterMs ?? rate.waitTime(bucket), MIN_RATE_LIMIT_WAIT_MS),
                  MAX_RATE_LIMIT_WAIT_MS,
                )
              : 1000 * 2 ** (attempt - 1);
          emit({ kind: "retry", bucket, failure: err.failure, attempt });
          await sleep(delay);
        }
      }
      // Unreachable: the last attempt always returns or throws.
      throw last ?? new SourceError("transport", "no attempt made");
    },
  };
}
