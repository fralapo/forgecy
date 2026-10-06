import { ForgecyError } from "@forgecy/core";
import type { ProviderId } from "@forgecy/core";

export type AiErrorKind =
  | "rate_limit"
  | "server"
  | "network"
  | "timeout"
  | "bad_request"
  | "auth"
  | "not_found"
  | "refusal"
  | "content_filter"
  | "max_tokens"
  | "invalid_output"
  | "aborted"
  | "unknown";

const retryableKinds = new Set<AiErrorKind>(["rate_limit", "server", "network", "timeout"]);
/** Kinds that justify switching to the task's fallback provider (policy permitting). */
const fallbackKinds = new Set<AiErrorKind>([...retryableKinds, "refusal", "content_filter"]);

/** Provider failure, classified so the gateway knows whether a fallback is allowed. */
export class AiProviderError extends ForgecyError {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly fallbackEligible: boolean;
  readonly status: number | undefined;
  readonly provider: ProviderId | undefined;

  constructor(
    kind: AiErrorKind,
    message: string,
    opts: {
      status?: number;
      provider?: ProviderId;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super("provider_error", message, {
      kind,
      status: opts.status,
      provider: opts.provider,
      ...opts.details,
    });
    this.name = "AiProviderError";
    this.kind = kind;
    this.retryable = retryableKinds.has(kind);
    this.fallbackEligible = fallbackKinds.has(kind);
    this.status = opts.status;
    this.provider = opts.provider;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export function kindForStatus(status: number): AiErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  // 409 is retried by both official SDKs (lock contention); treat as transient.
  if (status === 409) return "server";
  return "bad_request";
}

/**
 * Map any thrown value (Anthropic/OpenAI SDK errors, fetch errors, aborts) to AiProviderError.
 * Both official SDKs expose `status` on APIError and name connection failures
 * APIConnectionError / APIConnectionTimeoutError, so duck typing covers both.
 */
export function classifyError(err: unknown, provider?: ProviderId): AiProviderError {
  if (err instanceof AiProviderError) return err;
  const e = err as { name?: unknown; status?: unknown; message?: unknown; code?: unknown } | null;
  const name = typeof e?.name === "string" ? e.name : "";
  const message = typeof e?.message === "string" ? e.message : String(err);
  const opts = { provider, cause: err } as {
    provider?: ProviderId;
    cause: unknown;
    status?: number;
  };

  if (name === "APIUserAbortError" || name === "AbortError")
    return new AiProviderError("aborted", message, opts);
  if (name === "APIConnectionTimeoutError" || name === "TimeoutError")
    return new AiProviderError("timeout", message, opts);
  if (name === "APIConnectionError") return new AiProviderError("network", message, opts);
  if (typeof e?.status === "number") {
    opts.status = e.status;
    return new AiProviderError(kindForStatus(e.status), message, opts);
  }
  // Undici raises TypeError("fetch failed") with a system error cause on network failures.
  if (err instanceof TypeError && /fetch failed|network/i.test(message))
    return new AiProviderError("network", message, opts);
  const code = typeof e?.code === "string" ? e.code : "";
  if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return new AiProviderError("network", message, opts);
  }
  return new AiProviderError("unknown", message, opts);
}
