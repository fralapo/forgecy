export type ForgecyErrorCode =
  | "not_found"
  | "conflict"
  | "validation"
  | "permission_denied"
  | "policy_blocked"
  | "budget_exceeded"
  | "provider_error"
  | "unavailable";

/**
 * Points to a translated message of @forgecy/i18n by its full key
 * (`{ key: "products.errors.notFound", values: { name } }`). Build it with
 * `localizedError` or `messageRef` from @forgecy/i18n.
 */
export type MessageRef = {
  key: string;
  values?: Record<string, string | number>;
};

/**
 * Domain error with a stable code the API layer maps to an HTTP status.
 * `message` is English (logs, API); `ref`, when present, is what the interface shows
 * in the user's language.
 */
export class ForgecyError extends Error {
  constructor(
    readonly code: ForgecyErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly ref?: MessageRef,
  ) {
    super(message);
    this.name = "ForgecyError";
  }
}

export const httpStatusFor: Record<ForgecyErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  validation: 422,
  permission_denied: 403,
  policy_blocked: 403,
  budget_exceeded: 402,
  provider_error: 502,
  unavailable: 503,
};

/** The message reference an error carries (ForgecyError, NeedsAttentionError...), if any. */
export function messageRefOf(err: unknown): MessageRef | null {
  const ref = (err as { ref?: unknown } | null)?.ref;
  return ref && typeof ref === "object" && typeof (ref as MessageRef).key === "string"
    ? (ref as MessageRef)
    : null;
}
