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

/**
 * Node's fetch() wraps every network/TLS failure in a generic `TypeError: fetch
 * failed`, with the real cause (ENOTFOUND, a timeout, a certificate error, our own
 * pinned-fetch DNS check, …) nested under `.cause` — possibly several levels deep.
 * Walks that chain so the UI shows the actual reason instead of the bare "fetch failed".
 */
export function describeFetchError(err: unknown): string {
  const seen = new Set<unknown>();
  let current: unknown = err;
  let detail: string | undefined;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { message?: unknown; code?: unknown; cause?: unknown };
    const message = typeof e.message === "string" ? e.message : undefined;
    const code = typeof e.code === "string" ? e.code : undefined;
    if (message && message !== "fetch failed")
      detail = code && !message.includes(code) ? `${code}: ${message}` : message;
    current = e.cause;
  }
  const fallback = err instanceof Error ? err.message : String(err);
  return (detail ?? fallback).split("\n")[0]!.slice(0, 160);
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
