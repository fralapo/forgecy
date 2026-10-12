import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { ForgecyError } from "@forgecy/core";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Validate a storage key: relative, `/`-separated, safe characters only, no `.`/`..` segments. */
export function assertValidKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
    throw new ForgecyError("validation", "Invalid storage key");
  }
  const segments = key.split("/");
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === "." || s === ".." || s.includes("..")) {
      throw new ForgecyError("validation", "Invalid storage key", { key });
    }
  }
}

export function isValidKey(key: string): boolean {
  try {
    assertValidKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Hex SHA-256 of a buffer. */
export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hex SHA-256 of a stream (consumes it). */
export async function sha256Stream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk as Uint8Array);
  return hash.digest("hex");
}

export interface ContentKeyInput {
  /** Omit for agency-wide files (stored under `system/`). */
  clientId?: string | null;
  /** Logical area, e.g. "assets", "fonts", "exports", "thumbs". */
  scope: string;
  /** Hex SHA-256 of the content: same bytes → same key (dedup). */
  sha256: string;
  /** Extension without dot, e.g. "png". */
  ext: string;
}

/** Deterministic, content-addressed key: `clients/<id>/<scope>/<sha>.<ext>` or `system/<scope>/<sha>.<ext>`. */
export function contentKey(input: ContentKeyInput): string {
  if (!/^[a-f0-9]{64}$/.test(input.sha256))
    throw new ForgecyError("validation", "sha256 must be 64 hex chars");
  if (!/^[a-z0-9]{1,10}$/.test(input.ext))
    throw new ForgecyError("validation", "Invalid extension");
  if (!/^[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/.test(input.scope)) {
    throw new ForgecyError("validation", "Invalid scope");
  }
  const base = input.clientId ? `clients/${input.clientId}` : "system";
  const key = `${base}/${input.scope}/${input.sha256}.${input.ext}`;
  assertValidKey(key);
  return key;
}

const EXT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  ttf: "font/ttf",
  otf: "font/otf",
  woff2: "font/woff2",
  zip: "application/zip",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXT_TYPES[ext] ?? "application/octet-stream";
}
