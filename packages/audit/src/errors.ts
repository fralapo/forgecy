import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
/**
 * Stable error codes shown in the audit UI next to the message (UX section 17).
 * Domain errors still use ForgecyError; this maps them to the codes people see.
 */
export const auditErrorCodes = [
  "SOURCE-UNAVAILABLE",
  "AUD-ROBOTS-BLOCKED",
  "AUD-CRAWL-TIMEOUT",
  "AUD-BROWSER-UNAVAILABLE",
  "AUD-HOST-BLOCKED",
  "INPUT-INVALID",
  "BUDGET-EXCEEDED",
  "POLICY-BLOCKED",
  "PROVIDER-UNAVAILABLE",
  "PERM-DENIED",
  "CONFLICT-DRAFT-REV",
] as const;
export type AuditErrorCode = (typeof auditErrorCodes)[number];

/**
 * Error raised by the crawler with a code the UI can show and explain. `message` is
 * English (logs, stored fallback); `ref`, when set, shows it in the reader's language.
 */
export class CrawlError extends Error {
  constructor(
    readonly code: AuditErrorCode,
    message: string,
    readonly ref?: MessageRef,
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

/** A CrawlError whose message is an `audit.stored.crawl` message. */
export function crawlError(
  code: AuditErrorCode,
  key: MessageKey & `audit.stored.crawl.${string}`,
  values?: MessageValues,
): CrawlError {
  return new CrawlError(code, englishMessage(key, values), messageRef(key, values));
}

/** UI code for any thrown value (ForgecyError codes, permission errors, crawl errors). */
export function auditErrorCode(err: unknown): AuditErrorCode | null {
  if (err instanceof CrawlError) return err.code;
  const code = (err as { code?: unknown } | null)?.code;
  switch (code) {
    case "permission_denied":
      return "PERM-DENIED";
    case "budget_exceeded":
      return "BUDGET-EXCEEDED";
    case "policy_blocked":
      return "POLICY-BLOCKED";
    case "provider_error":
    case "unavailable":
      return "PROVIDER-UNAVAILABLE";
    case "validation":
      return "INPUT-INVALID";
    case "conflict":
      return "CONFLICT-DRAFT-REV";
    default:
      return null;
  }
}
