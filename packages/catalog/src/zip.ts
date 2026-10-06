import yauzl from "yauzl";
import { ImportError } from "./errors";
import { IMPORT_LIMITS } from "./limits";

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

const tooLarge = (msg: string) => new ImportError("IMPORT-TOO-LARGE", msg);

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
  const label = opts.label ? `"${opts.label}"` : "The archive";

  let zip: yauzl.ZipFile;
  try {
    zip = await open(source);
  } catch {
    throw new ImportError("IMPORT-INVALID", `${label} is not a readable ZIP.`);
  }
  try {
    if (zip.entryCount > maxEntries * 2)
      throw tooLarge(
        `${label} contains too many files (max ${maxEntries}). Split it into several ZIPs.`,
      );
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
            throw tooLarge(
              `${label} contains more than ${maxEntries} files. Split it into several ZIPs.`,
            );
          declaredTotal += entry.uncompressedSize;
          if (declaredTotal > maxTotal)
            throw tooLarge(
              `${label} exceeds ${Math.round(maxTotal / 1024 / 1024)} MB uncompressed. Split it into several ZIPs.`,
            );
          if (
            entry.uncompressedSize > 1024 * 1024 &&
            entry.uncompressedSize / Math.max(1, entry.compressedSize) > maxRatio
          )
            throw tooLarge(`${label} contains a file with an abnormal compression ratio.`);
          entries.push(info);
          if (opts.want?.(info) && opts.onData) {
            if (entry.uncompressedSize > maxEntryBytes)
              throw tooLarge(`"${path}" exceeds the maximum allowed size.`);
            const data = await readEntry(zip, entry, maxEntryBytes);
            readTotal += data.length;
            if (readTotal > maxTotal) throw tooLarge(`${label} is too large uncompressed.`);
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
    throw new ImportError("IMPORT-INVALID", `${label} is damaged or unreadable.`);
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
          stream.destroy(tooLarge(`"${entry.fileName}" exceeds the maximum allowed size.`));
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
 * Office files (XLSX, DOCX) are ZIPs: check them with the same guard before handing
 * them to a parser, so a crafted spreadsheet cannot exhaust memory.
 */
export async function assertSafeOfficeFile(data: Buffer, name: string): Promise<void> {
  await readZip(data, {
    label: name,
    maxEntries: 5_000,
    maxUncompressedBytes: IMPORT_LIMITS.officeUncompressedBytes,
    maxEntryRatio: 1_000,
  });
}
