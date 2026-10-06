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
  /** XLSX and DOCX are ZIPs too: uncompressed cap for their parts. */
  officeUncompressedBytes: 100 * MB,
  pdfPages: 500,
  filesPerImport: 2_000,
  /** Characters of PDF text sent to the AI per request. */
  pdfChunkChars: 24_000,
} as const;

export const IMPORT_LIMITS_TEXT =
  "CSV o XLSX fino a 10.000 righe · cartelle o ZIP fino a 200 MB e 2.000 file · immagini PNG, JPG, WebP fino a 20 MB · testi TXT, DOCX · PDF fino a 50 MB";

export const MAX_UPLOAD_BYTES = Math.max(
  IMPORT_LIMITS.archiveBytes,
  IMPORT_LIMITS.pdfBytes,
  IMPORT_LIMITS.sheetBytes,
);
