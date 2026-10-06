import { ForgecyError } from "@forgecy/core";
import { type TemplateManifest, templateManifestSchema } from "./template-schema";

/**
 * A template package in the canonical format: `template.json`, `layouts/*.html`,
 * `styles.css`, `fonts/`, `assets/`. Files are kept in memory as bytes so the same
 * object comes from the repository folder, an uploaded ZIP or storage.
 */
export interface TemplatePackage {
  manifest: TemplateManifest;
  files: ReadonlyMap<string, Uint8Array>;
}

export const MANIFEST_FILE = "template.json";
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_PACKAGE_FILES = 400;

const PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Package-relative path check: no absolute paths, no `..`, no hidden files. */
export function isSafePackagePath(p: string): boolean {
  return p.length <= 200 && PATH.test(p) && !p.split("/").some((s) => s === ".." || s === ".");
}

const decoder = new TextDecoder("utf-8", { fatal: false });
export function readText(pkg: Pick<TemplatePackage, "files">, path: string): string | undefined {
  const bytes = pkg.files.get(path);
  return bytes ? decoder.decode(bytes) : undefined;
}

export type ParseManifestResult =
  | { ok: true; manifest: TemplateManifest }
  | { ok: false; errors: { path: string; message: string }[] };

export function parseManifest(text: string | undefined): ParseManifestResult {
  if (text === undefined)
    return { ok: false, errors: [{ path: MANIFEST_FILE, message: "template.json mancante" }] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      errors: [{ path: MANIFEST_FILE, message: `JSON non valido: ${(err as Error).message}` }],
    };
  }
  const parsed = templateManifestSchema.safeParse(json);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => ({
      path: i.path.length ? i.path.join(".") : "(radice)",
      message: i.message,
    })),
  };
}

/** Build a package from a file map; throws `validation` when template.json is unusable. */
export function packageFromFiles(files: ReadonlyMap<string, Uint8Array>): TemplatePackage {
  const parsed = parseManifest(readText({ files }, MANIFEST_FILE));
  if (!parsed.ok) {
    const first = parsed.errors[0];
    throw new ForgecyError(
      "validation",
      `template.json non valido: ${first ? `${first.path}: ${first.message}` : "errore"}`,
      { errors: parsed.errors },
    );
  }
  return { manifest: parsed.manifest, files };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function mimeForPath(path: string): string | undefined {
  return MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
}

export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Data URL of a package file usable as image or font, or undefined. */
export function packageFileDataUrl(pkg: TemplatePackage, path: string): string | undefined {
  const bytes = pkg.files.get(path);
  const mime = mimeForPath(path);
  return bytes && mime ? dataUrl(bytes, mime) : undefined;
}
