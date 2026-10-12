import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";

/** Error codes of the import (spec section 17), shown with message, action and "Guide". */
export const importErrorCodes = [
  "IMPORT-INVALID",
  "IMPORT-TOO-LARGE",
  "IMPORT-PDF-UNREADABLE",
  "IMPORT-CSV-ENCODING",
  "IMPORT-FAILED",
  "POLICY-BLOCKED",
  "BUDGET-EXCEEDED",
  "PROVIDER-UNAVAILABLE",
  "DISK-FULL",
  "CONFLICT-STATE",
  "CONFLICT-DRAFT-REV",
  "PERM-DENIED",
] as const;
export type ImportErrorCode = (typeof importErrorCodes)[number];

/**
 * A recoverable problem with one file or step, with a code the UI shows.
 * `message` is English (logs, stored fallback); `ref`, when present, is what the
 * interface shows in the user's language.
 */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly ref?: MessageRef,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** An ImportError the interface can translate: `importError("IMPORT-INVALID", "products.errors.fileEmpty", { name })`. */
export function importError(
  code: ImportErrorCode,
  key: MessageKey,
  values?: MessageValues,
): ImportError {
  return new ImportError(code, englishMessage(key, values), messageRef(key, values));
}

export function isImportError(err: unknown): err is ImportError {
  return err instanceof ImportError || (err instanceof Error && err.name === "ImportError");
}
