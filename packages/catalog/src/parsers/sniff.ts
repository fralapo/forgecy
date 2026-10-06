import type { AiPolicy, ImportFileKind, ImportFileRoute } from "@forgecy/core";
import { IMPORT_LIMITS } from "../import/limits";
import { extensionOf } from "./text";

export type SniffedFormat =
  "csv" | "xlsx" | "pdf" | "png" | "jpg" | "webp" | "txt" | "docx" | "zip";

export interface SniffResult {
  ok: boolean;
  kind: ImportFileKind;
  format?: SniffedFormat;
  mime?: string;
  ext?: string;
  /** Present when `ok` is false. */
  code?: "IMPORT-INVALID" | "IMPORT-TOO-LARGE";
  message?: string;
}

const at = (b: Uint8Array, offset: number, sig: number[]) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const isZip = (b: Uint8Array) =>
  at(b, 0, [0x50, 0x4b, 0x03, 0x04]) || at(b, 0, [0x50, 0x4b, 0x05, 0x06]);

const FORMAT_INFO: Record<SniffedFormat, { kind: ImportFileKind; mime: string; max: number }> = {
  csv: { kind: "sheet", mime: "text/csv", max: IMPORT_LIMITS.sheetBytes },
  xlsx: {
    kind: "sheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    max: IMPORT_LIMITS.sheetBytes,
  },
  pdf: { kind: "pdf", mime: "application/pdf", max: IMPORT_LIMITS.pdfBytes },
  png: { kind: "image", mime: "image/png", max: IMPORT_LIMITS.imageBytes },
  jpg: { kind: "image", mime: "image/jpeg", max: IMPORT_LIMITS.imageBytes },
  webp: { kind: "image", mime: "image/webp", max: IMPORT_LIMITS.imageBytes },
  txt: { kind: "text", mime: "text/plain", max: IMPORT_LIMITS.textBytes },
  docx: {
    kind: "text",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    max: IMPORT_LIMITS.sheetBytes,
  },
  zip: { kind: "archive", mime: "application/zip", max: IMPORT_LIMITS.archiveBytes },
};

const MB = 1024 * 1024;

/** Formats people recognize, used in error messages. */
export const ACCEPTED_FORMATS_TEXT = "ZIP, CSV, XLSX, PNG, JPG, WebP, TXT, DOCX or PDF";

/**
 * Recognize a file from its name and first bytes. The extension picks the candidate,
 * the magic bytes must agree (a renamed executable is never accepted).
 */
export function sniffFile(name: string, size: number, head: Uint8Array): SniffResult {
  const ext = extensionOf(name);
  const fail = (code: SniffResult["code"], message: string): SniffResult => ({
    ok: false,
    kind: "ignored",
    code,
    message,
  });
  if (size <= 0) return fail("IMPORT-INVALID", `"${name}" is empty.`);

  let format: SniffedFormat | undefined;
  if (at(head, 0, ascii("%PDF-"))) format = "pdf";
  else if (at(head, 0, [0x89, 0x50, 0x4e, 0x47])) format = "png";
  else if (at(head, 0, [0xff, 0xd8, 0xff])) format = "jpg";
  else if (at(head, 0, ascii("RIFF")) && at(head, 8, ascii("WEBP"))) format = "webp";
  else if (isZip(head)) {
    if (ext === "xlsx") format = "xlsx";
    else if (ext === "docx") format = "docx";
    else if (ext === "zip") format = "zip";
  } else if ((ext === "csv" || ext === "tsv") && !head.includes(0)) format = "csv";
  else if ((ext === "txt" || ext === "md") && !head.includes(0)) format = "txt";

  if (!format) {
    return fail(
      "IMPORT-INVALID",
      `"${name}" is not an allowed format. Use ${ACCEPTED_FORMATS_TEXT}.`,
    );
  }
  // Extension and content must agree for binary formats (e.g. a PNG renamed .pdf is refused).
  // Photos are often saved with the wrong image extension, so any image extension fits an image.
  const imageExt = ["png", "jpg", "jpeg", "webp"];
  const expectedExt: Partial<Record<SniffedFormat, string[]>> = {
    pdf: ["pdf"],
    png: imageExt,
    jpg: imageExt,
    webp: imageExt,
  };
  const allowedExt = expectedExt[format];
  if (allowedExt && !allowedExt.includes(ext)) {
    return fail(
      "IMPORT-INVALID",
      `"${name}" has an extension that does not match its content. Use ${ACCEPTED_FORMATS_TEXT}.`,
    );
  }
  const info = FORMAT_INFO[format];
  if (size > info.max) {
    return fail(
      "IMPORT-TOO-LARGE",
      format === "zip"
        ? `"${name}" exceeds 200 MB (or 2,000 files). Split it into several ZIPs.`
        : `"${name}" exceeds ${Math.round(info.max / MB)} MB.`,
    );
  }
  return { ok: true, kind: info.kind, format, mime: info.mime, ext: format };
}

export interface RouteChoice {
  route: ImportFileRoute;
  /** Why the AI path is not available, when it isn't. */
  aiUnavailableReason?: string;
}

/** Whether the client policy (and configuration) lets the import use AI at all. */
export function aiAvailability(
  policy: AiPolicy,
  localModelConfigured: boolean,
): { available: boolean; reason?: string } {
  if (policy === "no_ai")
    return {
      available: false,
      reason:
        "AI is turned off for this client: PDFs and images cannot be analyzed. Images are matched only by file name and SKU.",
    };
  if (policy === "local_only" && !localModelConfigured)
    return {
      available: false,
      reason:
        "The client allows only local AI and no local model is configured: using manual mapping, matching by file name and SKU, and PDFs as sources.",
    };
  return { available: true };
}

/** Proposed path per type (table on page 73). */
export function proposeRoute(kind: ImportFileKind, aiAvailable: boolean): ImportFileRoute {
  switch (kind) {
    case "sheet":
      return "map";
    case "image":
    case "text":
    case "archive":
      return "match";
    case "pdf":
      return aiAvailable ? "extract" : "source";
    case "ignored":
      return "ignore";
  }
}

export const routeLabels: Record<ImportFileRoute, string> = {
  map: "Map the columns",
  match: "Match images and texts",
  extract: "Extract products",
  source: "Use as source",
  ignore: "Ignore",
};

export const kindLabels: Record<ImportFileKind, string> = {
  sheet: "Product sheet",
  pdf: "Client PDF",
  image: "Image",
  text: "Text",
  archive: "Folder or ZIP",
  ignored: "Not allowed",
};

/** Routes the user can pick for a kind. */
export function routesFor(kind: ImportFileKind, aiAvailable: boolean): ImportFileRoute[] {
  switch (kind) {
    case "sheet":
      return ["map", "ignore"];
    case "pdf":
      return aiAvailable ? ["extract", "source", "ignore"] : ["source", "ignore"];
    case "image":
    case "text":
    case "archive":
      return ["match", "ignore"];
    case "ignored":
      return ["ignore"];
  }
}
