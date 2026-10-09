/**
 * What a brand book import accepts (spec Flow D): PDF, PPTX, DOCX, images, SVG,
 * fonts and plain text. Types come from the bytes, never from the name alone.
 */
import type { MessageRef } from "@forgecy/core";
import { listZipNames, UPLOAD_LIMITS, validateUpload, ZipLimitError } from "@forgecy/files";
import { englishMessage, messageRef, type MessageKey } from "@forgecy/i18n";

export type ImportFileType = "pdf" | "docx" | "pptx" | "image" | "svg" | "font" | "text";

export interface DetectedImport {
  type: ImportFileType;
  mime: string;
  ext: string;
}

export type DetectResult =
  | ({ ok: true } & DetectedImport)
  /** `message` is English; `ref`, when set, is the same text for the interface. */
  | { ok: false; message: string; ref?: MessageRef };

const refused = (
  key: (MessageKey & `brand.errors.${string}`) | "brand.import.errors.archiveTooLarge",
) => ({ ok: false, message: englishMessage(key), ref: messageRef(key) }) as const;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** More entries than any real Office file holds (a media-heavy 50 MB deck has a few thousand). */
const MAX_DETECT_ENTRIES = 10_000;

/** From the central directory alone: nothing is inflated, however the archive is built. */
async function ooxmlKind(bytes: Uint8Array): Promise<"docx" | "pptx" | null> {
  const names = await listZipNames(bytes, { maxEntries: MAX_DETECT_ENTRIES }).catch(
    (err: unknown): string[] => {
      if (err instanceof ZipLimitError) throw err;
      return []; // not a readable zip
    },
  );
  if (names.includes("word/document.xml")) return "docx";
  if (names.includes("ppt/presentation.xml")) return "pptx";
  return null;
}

const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** Detects the file type and enforces the size limits (documents 50 MB, images 20 MB, fonts 10 MB). */
export async function detectImportFile(input: {
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<DetectResult> {
  const { bytes, name } = input;
  const size = bytes.byteLength;
  if (size === 0) return refused("brand.errors.fileEmpty");

  if (isZip(bytes)) {
    if (size > UPLOAD_LIMITS.document) return refused("brand.errors.fileTooLarge");
    let kind: Awaited<ReturnType<typeof ooxmlKind>>;
    try {
      kind = await ooxmlKind(bytes);
    } catch {
      return refused("brand.import.errors.archiveTooLarge");
    }
    if (kind === "docx") return { ok: true, type: "docx", mime: DOCX_MIME, ext: "docx" };
    if (kind === "pptx") return { ok: true, type: "pptx", mime: PPTX_MIME, ext: "pptx" };
    return refused("brand.errors.archiveUnsupported");
  }

  const head = bytes.subarray(0, 4096);
  const e = ext(name);
  const declared = input.mime || "";
  const kinds = ["document", "image", "font"] as const;
  for (const kind of kinds) {
    const r = validateUpload({
      kind,
      mime:
        kind === "document" && (e === "md" || e === "txt") && !declared ? "text/plain" : declared,
      size,
      firstBytes: head,
      allowSvg: true,
    });
    if (!r.ok) {
      if (r.reason === "too_large") return { ok: false, message: r.message };
      continue;
    }
    if (r.mime === "application/pdf") return { ok: true, type: "pdf", mime: r.mime, ext: r.ext };
    if (r.mime === "image/svg+xml") return { ok: true, type: "svg", mime: r.mime, ext: r.ext };
    if (kind === "image") return { ok: true, type: "image", mime: r.mime, ext: r.ext };
    if (kind === "font") return { ok: true, type: "font", mime: r.mime, ext: r.ext };
    if (r.mime === "text/plain" || r.mime === "text/markdown")
      return { ok: true, type: "text", mime: r.mime, ext: r.ext };
  }
  // WOFF (1.0) is not in the generic upload list but is a common font delivery format.
  if (head[0] === 0x77 && head[1] === 0x4f && head[2] === 0x46 && head[3] === 0x46) {
    if (size > UPLOAD_LIMITS.font) return refused("brand.errors.fontTooLarge");
    return { ok: true, type: "font", mime: "font/woff", ext: "woff" };
  }
  return refused("brand.errors.formatNotAllowed");
}
