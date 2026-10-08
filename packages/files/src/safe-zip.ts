/**
 * Reading untrusted ZIPs (Office files, product archives) without trusting a single number
 * the archive declares. The central directory is read with yauzl and only the requested
 * parts are ever inflated. Every limit is enforced on the bytes really produced, counted
 * as they stream and shared by all reads of one call, so overlapping entries, stored
 * entries with a lying size and decompression bombs all stop at the budget; the stream is
 * destroyed the moment it is exceeded, so the CPU spent is bounded by the budget too.
 * yauzl (validateEntrySizes) additionally refuses an entry whose real size differs from
 * the declared one, and a stored entry whose two declared sizes differ.
 */
import yauzl from "yauzl";

export type ZipLimitReason = "entries" | "entry_bytes" | "total_bytes";

/** A limit was exceeded. Any other error from this module means "not a readable ZIP". */
export class ZipLimitError extends Error {
  constructor(readonly reason: ZipLimitReason) {
    super(`ZIP limit exceeded: ${reason}`);
    this.name = "ZipLimitError";
  }
}

export interface ZipPartsLimits {
  /** Entries in the central directory (every one, wanted or not). */
  maxEntries: number;
  /** Real inflated bytes of any one part. */
  maxEntryBytes: number;
  /** Real inflated bytes of all the parts read, summed (a part read twice counts twice). */
  maxTotalBytes: number;
}

export type ZipSource = Uint8Array | string;

function open(source: ZipSource): Promise<yauzl.ZipFile> {
  const opts = { lazyEntries: true, autoClose: false, validateEntrySizes: true };
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zip?: yauzl.ZipFile) =>
      err || !zip ? reject(err ?? new Error("Unreadable ZIP")) : resolve(zip);
    if (typeof source === "string") yauzl.open(source, opts, cb);
    else
      yauzl.fromBuffer(Buffer.from(source.buffer, source.byteOffset, source.byteLength), opts, cb);
  });
}

async function walk(
  source: ZipSource,
  maxEntries: number,
  visit: (zip: yauzl.ZipFile, entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  const zip = await open(source);
  try {
    if (zip.entryCount > maxEntries) throw new ZipLimitError("entries");
    await new Promise<void>((resolve, reject) => {
      let seen = 0;
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        if (++seen > maxEntries) return reject(new ZipLimitError("entries"));
        visit(zip, entry).then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/** The entry names of a ZIP, read from the central directory; nothing is inflated. */
export async function listZipNames(
  source: ZipSource,
  limits: Pick<ZipPartsLimits, "maxEntries">,
): Promise<string[]> {
  const names: string[] = [];
  await walk(source, limits.maxEntries, async (_zip, entry) => {
    names.push(entry.fileName);
  });
  return names;
}

function readPart(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxEntryBytes: number,
  budget: { left: number },
  keep: boolean,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error("Unreadable entry"));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        budget.left -= chunk.length;
        if (size > maxEntryBytes || budget.left < 0) {
          // Stops the inflater too (nothing consumes its output any more).
          stream.destroy();
          reject(new ZipLimitError(size > maxEntryBytes ? "entry_bytes" : "total_bytes"));
          return;
        }
        if (keep) chunks.push(chunk);
      });
      stream.on("end", () => resolve(keep ? Buffer.concat(chunks, size) : new Uint8Array(0)));
      stream.on("error", reject);
    });
  });
}

async function walkParts(
  source: ZipSource,
  opts: ZipPartsLimits & { select: (name: string) => boolean },
  keep: boolean,
): Promise<Map<string, Uint8Array>> {
  const parts = new Map<string, Uint8Array>();
  const budget = { left: opts.maxTotalBytes };
  let declared = 0;
  await walk(source, opts.maxEntries, async (zip, entry) => {
    if (entry.fileName.endsWith("/") || !opts.select(entry.fileName)) return;
    declared += entry.uncompressedSize;
    if (entry.uncompressedSize > opts.maxEntryBytes) throw new ZipLimitError("entry_bytes");
    if (declared > opts.maxTotalBytes) throw new ZipLimitError("total_bytes");
    const data = await readPart(zip, entry, opts.maxEntryBytes, budget, keep);
    if (keep) parts.set(entry.fileName, data);
  });
  return parts;
}

/**
 * The inflated bytes of the parts `select` accepts, by exact entry name. Throws
 * ZipLimitError past a limit, any other error when the ZIP is unreadable or an entry lies
 * about its size.
 */
export function readZipParts(
  source: ZipSource,
  opts: ZipPartsLimits & { select: (name: string) => boolean },
): Promise<Map<string, Uint8Array>> {
  return walkParts(source, opts, true);
}

/**
 * Same checks and limits as readZipParts (real bytes, shared budget, stream destroyed on
 * excess) but the inflated bytes are counted and dropped as they stream, so memory stays flat.
 * For guarding a ZIP that a parser will read again.
 */
export async function validateZipParts(
  source: ZipSource,
  opts: ZipPartsLimits & { select: (name: string) => boolean },
): Promise<void> {
  await walkParts(source, opts, false);
}
