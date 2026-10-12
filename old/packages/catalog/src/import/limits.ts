const MB = 1024 * 1024;

/**
 * Import limits (spec page 73), shown under the upload area. The ZIP limits are
 * also the zip-bomb guard: declared and actual uncompressed sizes are both checked.
 */
export const IMPORT_LIMITS = {
  sheetRows: 10_000,
  archiveBytes: 200 * MB,
  archiveFiles: 2_000,
  /** Uncompressed total of an archive. */
  archiveUncompressedBytes: 200 * MB,
  /** Max compression ratio of a single entry; text compresses well, bombs reach 1000:1. */
  archiveEntryMaxRatio: 200,
  imageBytes: 20 * MB,
  pdfBytes: 50 * MB,
  sheetBytes: 50 * MB,
  textBytes: 5 * MB,
  /**
   * XLSX and DOCX are ZIPs too. Each XML/.rels part is bounded on its own (a 10,000-row sheet
   * is a few MB; one huge sheet or pivot cache is the real outlier worth refusing).
   */
  officePartBytes: 50 * MB,
  /**
   * Ceiling for all the inflated XML/.rels bytes of one Office package: 4x the per-part limit,
   * so a spreadsheet with several large parts (pivot caches, shared strings, sheets) passes
   * while a package of many parts that each look fine still cannot exhaust memory or CPU.
   */
  officeTotalBytes: 4 * 50 * MB,
  pdfPages: 500,
  filesPerImport: 2_000,
  /** Characters of PDF text sent to the AI per request. */
  pdfChunkChars: 24_000,
} as const;

export const IMPORT_LIMITS_TEXT =
  "CSV or XLSX up to 10,000 rows · folders or ZIP up to 200 MB and 2,000 files · PNG, JPG, WebP images up to 20 MB · TXT, DOCX texts · PDF up to 50 MB";

export const MAX_UPLOAD_BYTES = Math.max(
  IMPORT_LIMITS.archiveBytes,
  IMPORT_LIMITS.pdfBytes,
  IMPORT_LIMITS.sheetBytes,
);
