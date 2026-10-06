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
 * Points to a translated message in the `errors` namespace of @forgecy/i18n
 * (`{ key: "products.notFound", values: { name } }`). Build it with `localizedError`.
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
