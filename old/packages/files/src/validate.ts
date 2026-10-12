import { ForgecyError } from "@forgecy/core";

export type UploadKind = "image" | "font" | "document";

const MB = 1024 * 1024;

/** Size caps per kind. Images: 20 MB (spec "Security"). */
export const UPLOAD_LIMITS: Record<UploadKind, number> = {
  image: 20 * MB,
  font: 10 * MB,
  document: 50 * MB,
};

export interface DetectedType {
  mime: string;
  ext: string;
}

interface Signature {
  type: DetectedType;
  kind: UploadKind;
  /** Declared MIME types accepted for this format (besides the canonical one). */
  aliases: string[];
  match(b: Uint8Array): boolean;
}

const bytesAt = (b: Uint8Array, offset: number, sig: number[]) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const SIGNATURES: Signature[] = [
  {
    kind: "image",
    type: { mime: "image/png", ext: "png" },
    aliases: [],
    match: (b) => bytesAt(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    kind: "image",
    type: { mime: "image/jpeg", ext: "jpg" },
    aliases: ["image/jpg", "image/pjpeg"],
    match: (b) => bytesAt(b, 0, [0xff, 0xd8, 0xff]),
  },
  {
    kind: "image",
    type: { mime: "image/gif", ext: "gif" },
    aliases: [],
    match: (b) => bytesAt(b, 0, ascii("GIF87a")) || bytesAt(b, 0, ascii("GIF89a")),
  },
  {
    kind: "image",
    type: { mime: "image/webp", ext: "webp" },
    aliases: [],
    match: (b) => bytesAt(b, 0, ascii("RIFF")) && bytesAt(b, 8, ascii("WEBP")),
  },
  {
    kind: "document",
    type: { mime: "application/pdf", ext: "pdf" },
    aliases: ["application/x-pdf"],
    match: (b) => bytesAt(b, 0, ascii("%PDF-")),
  },
  {
    kind: "document",
    type: {
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ext: "xlsx",
    },
    aliases: [],
    match: (b) => bytesAt(b, 0, [0x50, 0x4b, 0x03, 0x04]),
  },
  {
    kind: "font",
    type: { mime: "font/ttf", ext: "ttf" },
    aliases: ["application/x-font-ttf", "application/font-sfnt", "font/sfnt"],
    match: (b) => bytesAt(b, 0, [0x00, 0x01, 0x00, 0x00]) || bytesAt(b, 0, ascii("true")),
  },
  {
    kind: "font",
    type: { mime: "font/otf", ext: "otf" },
    aliases: [
      "application/x-font-otf",
      "application/vnd.ms-opentype",
      "font/opentype",
      "application/font-sfnt",
      "font/sfnt",
    ],
    match: (b) => bytesAt(b, 0, ascii("OTTO")),
  },
  {
    kind: "font",
    type: { mime: "font/woff2", ext: "woff2" },
    aliases: ["application/font-woff2"],
    match: (b) => bytesAt(b, 0, ascii("wOF2")),
  },
];

/** Text documents have no magic bytes: accepted by declared MIME when the head contains no NUL bytes. */
const TEXT_DOCUMENTS: Record<string, DetectedType> = {
  "text/csv": { mime: "text/csv", ext: "csv" },
  "application/csv": { mime: "text/csv", ext: "csv" },
  "text/plain": { mime: "text/plain", ext: "txt" },
  "text/markdown": { mime: "text/markdown", ext: "md" },
  "application/json": { mime: "application/json", ext: "json" },
};

/** Browsers often send these for fonts or unknown files: rely on sniffing alone. */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function looksLikeSvg(b: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(b.subarray(0, 1024))
    .replace(/^\uFEFF/, "")
    .trimStart();
  return (
    (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) &&
    head.includes("<svg")
  );
}

export interface ValidateUploadInput {
  kind: UploadKind;
  /** MIME type declared by the client (Content-Type). Never trusted alone. */
  mime: string;
  size: number;
  /** At least the first 16 bytes (more is fine; 1 KB recommended for SVG/text). */
  firstBytes: Uint8Array;
  /**
   * SVG can carry scripts: off by default. Enable only where the file is rasterised or
   * served with `Content-Security-Policy: sandbox` / as attachment.
   */
  allowSvg?: boolean;
}

export type ValidateUploadResult =
  | ({ ok: true } & DetectedType)
  | {
      ok: false;
      reason: "empty" | "too_large" | "unsupported_type" | "mime_mismatch";
      message: string;
    };

/** Check type (magic bytes) and size of an upload. Fonts: only TTF, OTF, WOFF2. */
export function validateUpload(input: ValidateUploadInput): ValidateUploadResult {
  const limit = UPLOAD_LIMITS[input.kind];
  if (!Number.isFinite(input.size) || input.size <= 0)
    return { ok: false, reason: "empty", message: "Empty file" };
  if (input.size > limit) {
    return {
      ok: false,
      reason: "too_large",
      message: `File too large (max ${Math.round(limit / MB)} MB)`,
    };
  }
  const declared = (input.mime ?? "").split(";")[0]!.trim().toLowerCase();
  const b = input.firstBytes;

  const sig = SIGNATURES.find((s) => s.kind === input.kind && s.match(b));
  if (sig) {
    const accepted =
      GENERIC_MIMES.has(declared) || declared === sig.type.mime || sig.aliases.includes(declared);
    if (!accepted) {
      return {
        ok: false,
        reason: "mime_mismatch",
        message: `The content does not match the declared type (${declared})`,
      };
    }
    return { ok: true, ...sig.type };
  }

  if (
    input.kind === "image" &&
    input.allowSvg &&
    (declared === "image/svg+xml" || GENERIC_MIMES.has(declared)) &&
    looksLikeSvg(b)
  ) {
    return { ok: true, mime: "image/svg+xml", ext: "svg" };
  }

  if (input.kind === "document") {
    const text = TEXT_DOCUMENTS[declared];
    if (text && !b.includes(0)) return { ok: true, ...text };
  }

  const allowed =
    input.kind === "font"
      ? "TTF, OTF, WOFF2"
      : input.kind === "image"
        ? "PNG, JPEG, WebP, GIF"
        : "PDF, XLSX, CSV, TXT, MD, JSON";
  return {
    ok: false,
    reason: "unsupported_type",
    message: `Unsupported file type (allowed: ${allowed})`,
  };
}

/** Same as validateUpload but throws ForgecyError("validation"). */
export function assertValidUpload(input: ValidateUploadInput): DetectedType {
  const res = validateUpload(input);
  if (!res.ok) throw new ForgecyError("validation", res.message, { reason: res.reason });
  return { mime: res.mime, ext: res.ext };
}
