import yauzl from "yauzl";
import { validateZipParts, ZipLimitError } from "@forgecy/files";
import { ImportError, importError } from "../import/errors";
import type { MessageKey, MessageValues } from "@forgecy/i18n";
import { IMPORT_LIMITS } from "../import/limits";

export interface ZipEntryInfo {
  /** Normalized relative path (forward slashes, no leading slash, no "..", no drive letters). */
  path: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ZipGuardOptions {
  maxEntries?: number;
  maxUncompressedBytes?: number;
  maxEntryRatio?: number;
  /** Max bytes of a single entry once read. */
  maxEntryBytes?: number;
}

export interface ZipListing {
  entries: ZipEntryInfo[];
  /** Entries skipped on purpose: folders, hidden/system files, links, encrypted. */
  skipped: number;
}

/**
 * Normalize an entry name and refuse anything that could escape a folder (zip slip).
 * We never extract by name to disk (files are stored content-addressed), but paths are
 * still used for grouping and shown to people.
 */
export function safeEntryPath(name: string): string | null {
  const unified = name.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[a-zA-Z]:/.test(unified)) return null;
  const parts = unified.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === ".." || p.includes("\0"))) return null;
  if (parts.length === 0) return null;
  return parts.join("/");
}

/** macOS resource forks, Windows thumbnails, dotfiles: never product material. */
export function isJunkPath(path: string): boolean {
  const parts = path.split("/");
  const last = parts[parts.length - 1]!;
  return (
    parts.some((p) => p === "__MACOSX" || p.startsWith(".")) ||
    last === "Thumbs.db" ||
    last === "desktop.ini"
  );
}

function open(source: string | Buffer): Promise<yauzl.ZipFile> {
  const opts = {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: false,
  };
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zip?: yauzl.ZipFile) =>
      err || !zip ? reject(err ?? new Error("zip open failed")) : resolve(zip);
    if (typeof source === "string") yauzl.open(source, opts, cb);
    else yauzl.fromBuffer(source, opts, cb);
  });
}

/** An XLSX or DOCX has a few dozen parts; 5,000 is generous. */
const OFFICE_MAX_ENTRIES = 5_000;

const tooLarge = (key: MessageKey, values?: MessageValues) =>
  importError("IMPORT-TOO-LARGE", key, values);

/**
 * Walk an archive reading only the central directory, enforcing the anti zip-bomb
 * limits on declared sizes, then optionally read selected entries with a hard cap on
 * actual bytes (yauzl also checks that actual and declared sizes match).
 */
export async function readZip(
  source: string | Buffer,
  opts: ZipGuardOptions & {
    /** Called for each accepted entry; return true to receive its bytes in `onData`. */
    want?: (entry: ZipEntryInfo) => boolean;
    onData?: (entry: ZipEntryInfo, data: Buffer) => Promise<void> | void;
    label?: string;
  } = {},
): Promise<ZipListing> {
  const maxEntries = opts.maxEntries ?? IMPORT_LIMITS.archiveFiles;
  const maxTotal = opts.maxUncompressedBytes ?? IMPORT_LIMITS.archiveUncompressedBytes;
  const maxRatio = opts.maxEntryRatio ?? IMPORT_LIMITS.archiveEntryMaxRatio;
  const maxEntryBytes = opts.maxEntryBytes ?? maxTotal;
  // "The archive" or the file name, quoted, in every message.
  const label = { named: opts.label ? "yes" : "no", name: opts.label ?? "" };

  let zip: yauzl.ZipFile;
  try {
    zip = await open(source);
  } catch {
    throw importError("IMPORT-INVALID", "products.errors.zipUnreadable", label);
  }
  try {
    if (zip.entryCount > maxEntries * 2)
      throw tooLarge("products.errors.zipTooManyEntries", { ...label, max: maxEntries });
    const entries: ZipEntryInfo[] = [];
    let skipped = 0;
    let declaredTotal = 0;
    let readTotal = 0;

    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        void (async () => {
          const isDir = entry.fileName.endsWith("/");
          // Unix mode in the high bits: 0o120000 = symlink.
          const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
          const encrypted = (entry.generalPurposeBitFlag & 0x1) !== 0;
          const path = safeEntryPath(entry.fileName);
          if (isDir || unixMode === 0o120000 || encrypted || !path || isJunkPath(path)) {
            if (!isDir) skipped++;
            zip.readEntry();
            return;
          }
          const info: ZipEntryInfo = {
            path,
            compressedSize: entry.compressedSize,
            uncompressedSize: entry.uncompressedSize,
          };
          if (entries.length + 1 > maxEntries)
            throw tooLarge("products.errors.zipMoreThan", { ...label, max: maxEntries });
          declaredTotal += entry.uncompressedSize;
          if (declaredTotal > maxTotal)
            throw tooLarge("products.errors.zipUncompressedMb", {
              ...label,
              mb: Math.round(maxTotal / 1024 / 1024),
            });
          if (
            entry.uncompressedSize > 1024 * 1024 &&
            entry.uncompressedSize / Math.max(1, entry.compressedSize) > maxRatio
          )
            throw tooLarge("products.errors.zipRatio", label);
          entries.push(info);
          if (opts.want?.(info) && opts.onData) {
            if (entry.uncompressedSize > maxEntryBytes)
              throw tooLarge("products.errors.zipEntryTooLarge", { path });
            const data = await readEntry(zip, entry, maxEntryBytes);
            readTotal += data.length;
            if (readTotal > maxTotal)
              throw tooLarge("products.errors.zipTooLargeUncompressed", label);
            await opts.onData(info, data);
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    return { entries, skipped };
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw importError("IMPORT-INVALID", "products.errors.zipDamaged", label);
  } finally {
    zip.close();
  }
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("no stream"));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > cap) {
          stream.destroy(tooLarge("products.errors.zipEntryTooLarge", { path: entry.fileName }));
          return;
        }
        chunks.push(c);
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * Office files (XLSX, DOCX) are ZIPs: before a parser decompresses anything, every part it
 * can ask for (the XML and relationship parts) is inflated once through the shared guarded
 * reader (counted and dropped, never kept), counting the bytes really produced (never the
 * declared sizes). A ZIP that lies
 * about its sizes, overlaps its entries or is a decompression bomb stops at the budget.
 * Media and other parts are never read by these parsers, so they are not inflated.
 */
export async function assertSafeOfficeFile(data: Buffer, name: string): Promise<void> {
  const label = { named: "yes", name };
  try {
    await validateZipParts(data, {
      select: (part) => /\.(xml|rels)$/i.test(part),
      maxEntries: OFFICE_MAX_ENTRIES,
      maxEntryBytes: IMPORT_LIMITS.officeUncompressedBytes,
      maxTotalBytes: IMPORT_LIMITS.officeUncompressedBytes,
    });
  } catch (err) {
    if (err instanceof ZipLimitError)
      throw err.reason === "entries"
        ? tooLarge("products.errors.zipTooManyEntries", { ...label, max: OFFICE_MAX_ENTRIES })
        : tooLarge("products.errors.zipTooLargeUncompressed", label);
    throw importError("IMPORT-INVALID", "products.errors.zipDamaged", label);
  }
}
