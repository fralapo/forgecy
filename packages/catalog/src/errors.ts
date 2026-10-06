/** Error codes of the import (spec section 17), shown with message, action and "Guida". */
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

/** A recoverable problem with one file or step, with a code the UI shows. */
export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export function isImportError(err: unknown): err is ImportError {
  return err instanceof ImportError || (err instanceof Error && err.name === "ImportError");
}
