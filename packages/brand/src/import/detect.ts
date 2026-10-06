/**
 * What a brand book import accepts (spec Flow D): PDF, PPTX, DOCX, images, SVG,
 * fonts and plain text. Types come from the bytes, never from the name alone.
 */
import { UPLOAD_LIMITS, validateUpload } from "@forgecy/files";
import { unzipSync } from "fflate";

export type ImportFileType = "pdf" | "docx" | "pptx" | "image" | "svg" | "font" | "text";

export interface DetectedImport {
  type: ImportFileType;
  mime: string;
  ext: string;
}

export type DetectResult =
  | ({ ok: true } & DetectedImport)
  | { ok: false; message: string };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function ooxmlKind(bytes: Uint8Array): "docx" | "pptx" | null {
  try {
    const names = Object.keys(
      unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" || f.name === "ppt/presentation.xml" }),
    );
    if (names.includes("word/document.xml")) return "docx";
    if (names.includes("ppt/presentation.xml")) return "pptx";
  } catch {
    // not a readable zip
  }
  return null;
}

const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/** Detects the file type and enforces the size limits (documents 50 MB, images 20 MB, fonts 10 MB). */
export function detectImportFile(input: { name: string; mime: string; bytes: Uint8Array }): DetectResult {
  const { bytes, name } = input;
  const size = bytes.byteLength;
  if (size === 0) return { ok: false, message: "Il file è vuoto." };

  if (isZip(bytes)) {
    if (size > UPLOAD_LIMITS.document) return { ok: false, message: "File troppo grande: il massimo è 50 MB." };
    const kind = ooxmlKind(bytes);
    if (kind === "docx") return { ok: true, type: "docx", mime: DOCX_MIME, ext: "docx" };
    if (kind === "pptx") return { ok: true, type: "pptx", mime: PPTX_MIME, ext: "pptx" };
    return { ok: false, message: "Archivio non supportato: carica PDF, PPTX, DOCX, immagini, SVG o font." };
  }

  const head = bytes.subarray(0, 4096);
  const e = ext(name);
  const declared = input.mime || "";
  const kinds = ["document", "image", "font"] as const;
  for (const kind of kinds) {
    const r = validateUpload({
      kind,
      mime: kind === "document" && (e === "md" || e === "txt") && !declared ? "text/plain" : declared,
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
    if (r.mime === "text/plain" || r.mime === "text/markdown") return { ok: true, type: "text", mime: r.mime, ext: r.ext };
  }
  // WOFF (1.0) is not in the generic upload list but is a common font delivery format.
  if (head[0] === 0x77 && head[1] === 0x4f && head[2] === 0x46 && head[3] === 0x46) {
    if (size > UPLOAD_LIMITS.font) return { ok: false, message: "Font troppo grande: il massimo è 10 MB." };
    return { ok: true, type: "font", mime: "font/woff", ext: "woff" };
  }
  return {
    ok: false,
    message: "Formato non ammesso: carica PDF, PPTX, DOCX, immagini (PNG, JPEG, WebP, GIF), SVG, font (TTF, OTF, WOFF, WOFF2) o testo.",
  };
}
