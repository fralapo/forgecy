import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ForgecyError, loadToolEnv } from "@forgecy/core";
import { readZipParts, ZipLimitError } from "@forgecy/files/safe-zip";
import { localizedError } from "@forgecy/i18n";
import {
  MANIFEST_FILE,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  type TemplatePackage,
  isSafePackagePath,
  packageFromFiles,
} from "./package";
import { type ValidationReport, validateTemplatePackage } from "./validate";

/** Node-only helpers: reading template packages from disk or from an uploaded ZIP. */

const IGNORED = new Set(["README.md", "LICENSE", "OFL.txt", "rules.md"]);

/** All files of a package folder as a map of POSIX relative paths (hidden files skipped). */
export async function readTemplateDir(dir: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  async function walk(rel: string) {
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(r);
      else if (e.isFile()) {
        if (!rel && IGNORED.has(e.name)) continue;
        const bytes = new Uint8Array(await readFile(path.join(dir, r)));
        total += bytes.length;
        if (files.size >= MAX_PACKAGE_FILES || total > MAX_PACKAGE_BYTES)
          throw localizedError("validation", "templates.errors.packageTooLarge", { dir });
        files.set(r, bytes);
      }
    }
  }
  await walk("");
  return files;
}

/**
 * Unpack an uploaded template ZIP (max 50 MB). A single top-level folder is
 * stripped, so both "zip of the folder" and "zip of its contents" work.
 * Read with the shared guarded reader: limits count the bytes really inflated, never the
 * sizes the archive declares (a client package brings template ZIPs that the web render
 * route unpacks, so a lying entry must not keep its event loop busy).
 */
export async function unzipTemplatePackage(zip: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (zip.length > MAX_PACKAGE_BYTES)
    throw localizedError("validation", "templates.errors.zipTooLarge");
  let count = 0;
  let raw: Map<string, Uint8Array>;
  try {
    raw = await readZipParts(zip, {
      // Folders and hidden files are entries too: room for them, the files are counted below.
      maxEntries: MAX_PACKAGE_FILES * 2,
      maxEntryBytes: MAX_PACKAGE_BYTES,
      maxTotalBytes: MAX_PACKAGE_BYTES,
      select: (name) => {
        if (++count > MAX_PACKAGE_FILES) throw new ZipLimitError("entries");
        const parts = name.split("/");
        if (name.startsWith("/") || parts.includes(".."))
          throw localizedError("validation", "templates.errors.zipPathNotAllowed", { name });
        return !parts.some((s) => s.startsWith(".") || s === "__MACOSX");
      },
    });
  } catch (err) {
    if (err instanceof ForgecyError) throw err;
    if (err instanceof ZipLimitError)
      throw localizedError("validation", "templates.errors.extractedTooLarge");
    // yauzl refuses absolute and ".." names itself, before `select` sees them.
    const path = /^(?:invalid relative path|absolute path): (.*)$/.exec(
      err instanceof Error ? err.message : "",
    );
    if (path)
      throw localizedError("validation", "templates.errors.zipPathNotAllowed", { name: path[1]! });
    throw localizedError("validation", "templates.errors.unreadableZip");
  }
  const names = [...raw.keys()];
  const first = names[0]?.split("/")[0];
  const strip =
    first && !names.includes(MANIFEST_FILE) && names.every((n) => n.startsWith(`${first}/`))
      ? `${first}/`
      : "";
  const files = new Map<string, Uint8Array>();
  for (const name of names.sort()) {
    const rel = name.slice(strip.length);
    if (!isSafePackagePath(name) || !isSafePackagePath(rel))
      throw localizedError("validation", "templates.errors.zipPathNotAllowed", { name });
    files.set(rel, raw.get(name)!);
  }
  return files;
}

/** `templates` of the repository, or FORGECY_TEMPLATES_DIR when set. */
export function defaultTemplatesDir(): string {
  const fromEnv = loadToolEnv().FORGECY_TEMPLATES_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "templates");
    if (existsSync(path.join(candidate, "template.schema.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve("templates");
}

export interface CatalogEntry {
  folder: string;
  report: ValidationReport;
  pkg?: TemplatePackage;
}

/**
 * Every package folder (one with a template.json) under `root`, validated. Packages sit either
 * directly under `root` or one level down in a grouping folder (`carousels/`, `reports/`);
 * `folder` is the path relative to `root`.
 */
export async function scanTemplateDir(root = defaultTemplatesDir()): Promise<CatalogEntry[]> {
  if (!existsSync(root)) return [];
  const out: CatalogEntry[] = [];
  async function scan(rel: string, depth: number) {
    const entries = (await readdir(path.join(root, rel), { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const folder = rel ? `${rel}/${e.name}` : e.name;
      const dir = path.join(root, folder);
      if (!existsSync(path.join(dir, MANIFEST_FILE))) {
        if (depth === 0) await scan(folder, 1);
        continue;
      }
      const files = await readTemplateDir(dir);
      const report = validateTemplatePackage(files);
      out.push({
        folder,
        report,
        ...(report.manifest ? { pkg: { manifest: report.manifest, files } } : {}),
      });
    }
  }
  await scan("", 0);
  return out;
}

/** Where templates come from. The directory source serves the repository catalog; a database-backed catalog can implement the same interface. */
export interface TemplateSource {
  get(id: string, version?: string): Promise<TemplatePackage | undefined>;
}

/** Templates read from a folder, cached by folder modification time. */
export function directoryTemplateSource(root = defaultTemplatesDir()): TemplateSource & {
  list(): Promise<CatalogEntry[]>;
} {
  let cache: { at: number; entries: CatalogEntry[] } | undefined;
  async function list() {
    const at = existsSync(root) ? (await stat(root)).mtimeMs : 0;
    if (!cache || cache.at !== at || process.env.NODE_ENV !== "production")
      cache = { at, entries: await scanTemplateDir(root) };
    return cache.entries;
  }
  return {
    list,
    async get(id, version) {
      const entry = (await list()).find((e) => e.pkg?.manifest.id === id);
      if (!entry?.pkg) return undefined;
      if (version && entry.pkg.manifest.version !== version) return undefined;
      return entry.pkg;
    },
  };
}

export { packageFromFiles };
export * from "./assets";
