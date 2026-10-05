export type ForgecyErrorCode =
  | "not_found"
  | "conflict"
  | "validation"
  | "permission_denied"
  | "policy_blocked"
  | "budget_exceeded"
  | "provider_error"
  | "unavailable";

/** Domain error with a stable code the API layer maps to an HTTP status. */
export class ForgecyError extends Error {
  constructor(
    readonly code: ForgecyErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
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
