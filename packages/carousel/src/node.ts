import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ForgecyError } from "@forgecy/core";
import { unzipSync } from "fflate";
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
          throw new ForgecyError("validation", `Package too large: ${dir}`);
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
 */
export function unzipTemplatePackage(zip: Uint8Array): Map<string, Uint8Array> {
  if (zip.length > MAX_PACKAGE_BYTES) throw new ForgecyError("validation", "ZIP over 50 MB");
  let total = 0;
  let count = 0;
  const raw = unzipSync(zip, {
    filter: (f) => {
      if (f.name.endsWith("/")) return false;
      count++;
      total += f.originalSize;
      if (count > MAX_PACKAGE_FILES || total > MAX_PACKAGE_BYTES)
        throw new ForgecyError("validation", "Package too large once extracted");
      const parts = f.name.split("/");
      if (f.name.startsWith("/") || parts.includes(".."))
        throw new ForgecyError("validation", `Path not allowed in the ZIP: ${f.name}`);
      return !parts.some((s) => s.startsWith(".") || s === "__MACOSX");
    },
  });
  const names = Object.keys(raw);
  const first = names[0]?.split("/")[0];
  const strip =
    first && !names.includes(MANIFEST_FILE) && names.every((n) => n.startsWith(`${first}/`))
      ? `${first}/`
      : "";
  const files = new Map<string, Uint8Array>();
  for (const name of names.sort()) {
    const rel = name.slice(strip.length);
    if (!isSafePackagePath(name) || !isSafePackagePath(rel))
      throw new ForgecyError("validation", `Path not allowed in the ZIP: ${name}`);
    files.set(rel, raw[name]!);
  }
  return files;
}

/** `templates` of the repository, or FORGECY_TEMPLATES_DIR when set. */
export function defaultTemplatesDir(): string {
  const fromEnv = process.env.FORGECY_TEMPLATES_DIR;
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
