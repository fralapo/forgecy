/**
 * Reading a client package: the ZIP written by `writeClientPackage`. Entries are read on
 * demand, so a large gallery never sits in memory as a whole. The ZIP is untrusted input:
 * names are validated, and sizes are enforced on the bytes actually inflated (the sizes a
 * ZIP declares are only a claim), so a small upload cannot expand without bound.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  CLIENT_PACKAGE_FORMAT,
  CLIENT_PACKAGE_MAX_ENTRIES,
  CLIENT_PACKAGE_MAX_JSON_BYTES,
  CLIENT_PACKAGE_MAX_RATIO,
  CLIENT_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  clientTransferAreas,
} from "@forgecy/core";
import yauzl from "yauzl";
import { z } from "zod";
import type { PackageManifest } from "./export";
import { UnsafePackageError } from "./safety";

export const packageManifestSchema = z.object({
  format: z.number().int().min(1).max(CLIENT_PACKAGE_FORMAT),
  app: z.literal("forgecy"),
  exportedAt: z.string(),
  schema: z.object({ migrations: z.number().int().min(0), last: z.string().nullable() }),
  client: z.object({ id: z.uuid(), name: z.string().min(1), slug: z.string().min(1) }),
  areas: z.array(z.enum(clientTransferAreas)),
  options: z.object({ excludeUnapprovedAi: z.boolean(), includeAgencyTemplates: z.boolean() }),
  tables: z.record(z.string(), z.object({ rows: z.number().int().min(0), sha256: z.string() })),
  files: z.array(z.object({ key: z.string(), bytes: z.number().int().min(0), sha256: z.string() })),
  people: z.number().int().min(0),
}) satisfies z.ZodType<PackageManifest>;

export const packagePeopleSchema = z.array(
  z.object({ id: z.string(), name: z.string(), email: z.string() }),
);
export type PackagePerson = z.infer<typeof packagePeopleSchema>[number];

export interface ClientPackage {
  names(): string[];
  has(name: string): boolean;
  /** The inflated bytes of an entry; fails once they exceed what the limits allow. */
  stream(name: string): Promise<Readable>;
  /** An entry as text; refuses one larger than `jsonBytes`. */
  text(name: string): Promise<string>;
  sha256(name: string): Promise<string>;
  close(): void;
}

export interface PackageLimits {
  entries: number;
  uncompressedBytes: number;
  jsonBytes: number;
  /** Inflated bytes per stored byte, applied to entries over 1 MiB. */
  ratio: number;
}
export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  entries: CLIENT_PACKAGE_MAX_ENTRIES,
  uncompressedBytes: CLIENT_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  jsonBytes: CLIENT_PACKAGE_MAX_JSON_BYTES,
  ratio: CLIENT_PACKAGE_MAX_RATIO,
};

/** Below this size the ratio means nothing (a few KB of zeros compress a lot). */
const RATIO_FLOOR = 1024 * 1024;
const MAX_NAME_BYTES = 1024;

/**
 * Names are exact keys and are never written to disk, but a name that could escape a folder
 * (or that another reader would normalize into a different one) is a sign of a hostile
 * package: refused outright, whatever the entry holds.
 */
function entryName(raw: Buffer): string {
  const bad = () => new UnsafePackageError("an entry has a name that is not allowed");
  if (raw.length > MAX_NAME_BYTES) throw bad();
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw bad();
  }
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name))
    throw bad();
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw bad();
  return name;
}

/** Opens the ZIP at `file`; throws when it is not a readable ZIP or is hostile. */
export async function openClientPackage(
  file: string,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<ClientPackage> {
  const tooBig = () => new UnsafePackageError("the package is larger than any Forgecy writes");
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    // decodeStrings off: the names are decoded and checked here, exactly as they are stored.
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, z) =>
      err || !z ? reject(err ?? new Error("Unreadable ZIP")) : resolve(z),
    ),
  );
  const entries = new Map<string, yauzl.Entry>();
  const seen = new Set<string>();
  let total = 0;
  try {
    if (zip.entryCount > limits.entries) throw tooBig();
    await new Promise<void>((resolve, reject) => {
      zip.on("entry", (e: yauzl.Entry) => {
        try {
          const name = entryName(e.fileNameRaw);
          if (seen.has(name)) throw new UnsafePackageError("an entry name is repeated");
          if (seen.size + 1 > limits.entries) throw tooBig();
          seen.add(name);
          if (!name.endsWith("/")) {
            total += e.uncompressedSize;
            // The sizes are a claim; reads are counted again on the bytes inflated (below), and
            // yauzl refuses an entry whose bytes differ from its claim.
            if (
              total > limits.uncompressedBytes ||
              (e.uncompressedSize > RATIO_FLOOR &&
                e.uncompressedSize > limits.ratio * Math.max(e.compressedSize, 1))
            )
              throw tooBig();
            entries.set(name, e);
          }
        } catch (err) {
          return reject(err);
        }
        zip.readEntry();
      });
      zip.on("end", () => resolve());
      zip.on("error", reject);
      zip.readEntry();
    });
  } catch (err) {
    zip.close();
    throw err;
  }

  // Bytes really inflated, per entry (the most any read of it produced) and in all.
  const inflated = new Map<string, number>();
  let inflatedTotal = 0;
  async function* counted(
    name: string,
    entry: yauzl.Entry,
    source: Readable,
    cap: number,
  ): AsyncGenerator<Buffer> {
    const stored = Math.max(entry.compressedSize, 1);
    let n = 0;
    for await (const chunk of source) {
      const b = chunk as Buffer;
      n += b.length;
      if (n > cap || (n > RATIO_FLOOR && n > limits.ratio * stored))
        throw new UnsafePackageError(`${name} inflates beyond the limits`);
      const before = inflated.get(name) ?? 0;
      if (n > before) {
        inflated.set(name, n);
        inflatedTotal += n - before;
        if (inflatedTotal > limits.uncompressedBytes) throw tooBig();
      }
      yield b;
    }
  }
  const open = (name: string, cap: number) => {
    const entry = entries.get(name);
    if (!entry) return Promise.reject(new Error(`Missing entry ${name}`));
    return new Promise<Readable>((resolve, reject) =>
      zip.openReadStream(entry, (err, s) =>
        err || !s
          ? reject(err ?? new Error(`Unreadable entry ${name}`))
          : resolve(Readable.from(counted(name, entry, s, cap))),
      ),
    );
  };
  const stream = (name: string) => open(name, limits.uncompressedBytes);
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    stream,
    text: async (name) => {
      const entry = entries.get(name);
      if (entry && entry.uncompressedSize > limits.jsonBytes)
        throw new UnsafePackageError(`${name} is too large to read`);
      const chunks: Buffer[] = [];
      for await (const chunk of await open(name, limits.jsonBytes)) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    sha256: async (name) => {
      const hash = createHash("sha256");
      for await (const chunk of await stream(name)) hash.update(chunk as Buffer);
      return hash.digest("hex");
    },
    close: () => zip.close(),
  };
}
