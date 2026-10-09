import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable, type Readable } from "node:stream";
import { zipArchive } from "@forgecy/core/testing/archives";
import type { PutOptions, StorageDriver } from "@forgecy/files";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyPackageFiles } from "../src/import";
import { openClientPackage, type ClientPackage } from "../src/package";
import { UnsafePackageError } from "../src/safety";

const CLIENT = "11111111-1111-4111-8111-11111111111a";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const keyFor = (b: Buffer) => `clients/${CLIENT}/assets/${sha(b)}.png`;

/**
 * Takes the body the way the S3 request handler does: `body.pipe(request)`, no error listener,
 * and the object is stored as soon as the stream is over, whatever way it ended.
 */
class PipingStorage {
  readonly name = "s3" as const;
  readonly objects = new Map<string, Buffer>();
  puts: string[] = [];
  async exists(key: string) {
    return this.objects.has(key);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async put(key: string, body: Uint8Array | Readable, _options: PutOptions) {
    this.puts.push(key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve) => {
      (body as Readable).pipe(
        new Writable({
          write(chunk: Buffer, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        }),
      );
      (body as Readable).once("close", () => resolve());
    });
    this.objects.set(key, Buffer.concat(chunks));
  }
}

describe("copyPackageFiles", () => {
  let dir: string;
  let pkg: ClientPackage | undefined;
  const crashes: unknown[] = [];
  const onCrash = (err: unknown) => crashes.push(err);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "forgecy-copy-"));
    crashes.length = 0;
    process.on("uncaughtException", onCrash);
    process.on("unhandledRejection", onCrash);
  });
  afterEach(() => {
    process.off("uncaughtException", onCrash);
    process.off("unhandledRejection", onCrash);
    pkg?.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const open = async (entries: { name: string; data: Buffer }[]) => {
    const file = join(dir, "p.zip");
    writeFileSync(file, zipArchive(entries));
    pkg = await openClientPackage(file);
    return pkg;
  };
  const run = async (
    storage: PipingStorage,
    files: { key: string; bytes: number; sha256: string }[],
    written: string[] = [],
  ) => {
    await copyPackageFiles(
      { pkg: pkg!, storage: storage as unknown as StorageDriver },
      files,
      (k) => k,
      written,
    );
    return written;
  };

  it("stores a file whose size and checksum match the manifest", async () => {
    const body = Buffer.from("approved image");
    await open([{ name: `files/${keyFor(body)}`, data: body }]);
    const storage = new PipingStorage();
    const written = await run(storage, [
      { key: keyFor(body), bytes: body.length, sha256: sha(body) },
    ]);
    expect(storage.objects.get(keyFor(body))?.equals(body)).toBe(true);
    expect(written).toEqual([keyFor(body)]);
    expect(crashes).toEqual([]);
  });

  const cases: Record<string, (good: Buffer) => { data: Buffer; bytes: number }> = {
    "same size, other bytes": (good) => ({
      data: Buffer.alloc(good.length, 0x41),
      bytes: good.length,
    }),
    "longer than the manifest says": (good) => ({
      data: Buffer.concat([good, Buffer.from("extra")]),
      bytes: good.length,
    }),
    "shorter than the manifest says": (good) => ({ data: good.subarray(0, 3), bytes: good.length }),
  };
  for (const [label, make] of Object.entries(cases))
    it(`fails the import, leaves no stored key and no uncaught exception: ${label}`, async () => {
      const good = Buffer.from("approved image");
      const { data, bytes } = make(good);
      const key = keyFor(good); // the manifest names the checksum of the good bytes
      await open([{ name: `files/${key}`, data }]);
      const storage = new PipingStorage();
      const written: string[] = [];
      const err = await run(storage, [{ key, bytes, sha256: sha(good) }], written).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(UnsafePackageError);
      // The driver stored it (S3 can answer 200 before the abort lands); it is removed again.
      expect(storage.puts).toEqual([key]);
      expect(storage.objects.has(key)).toBe(false);
      expect(written).toEqual([key]);
      await new Promise((r) => setTimeout(r, 20));
      expect(crashes).toEqual([]);
    });

  it("stops at the first bad file and removes the ones already written", async () => {
    const a = Buffer.from("first file");
    const b = Buffer.from("second file");
    await open([
      { name: `files/${keyFor(a)}`, data: a },
      { name: `files/${keyFor(b)}`, data: Buffer.from("tampered!!") },
    ]);
    const storage = new PipingStorage();
    await expect(
      run(storage, [
        { key: keyFor(a), bytes: a.length, sha256: sha(a) },
        { key: keyFor(b), bytes: b.length, sha256: sha(b) },
      ]),
    ).rejects.toBeInstanceOf(UnsafePackageError);
    expect([...storage.objects.keys()]).toEqual([]);
    expect(crashes).toEqual([]);
  });

  it("does not touch a key that already exists", async () => {
    const body = Buffer.from("same content");
    await open([{ name: `files/${keyFor(body)}`, data: Buffer.from("tampered!!!") }]);
    const storage = new PipingStorage();
    storage.objects.set(keyFor(body), body);
    const written = await run(storage, [
      { key: keyFor(body), bytes: body.length, sha256: sha(body) },
    ]);
    expect(storage.puts).toEqual([]);
    expect(written).toEqual([]);
    expect(storage.objects.get(keyFor(body))?.equals(body)).toBe(true);
  });

  it("removes what it wrote when the driver itself fails", async () => {
    const body = Buffer.from("approved image");
    await open([{ name: `files/${keyFor(body)}`, data: body }]);
    const storage = new PipingStorage();
    storage.put = async (key: string) => {
      storage.objects.set(key, Buffer.from("half"));
      throw new Error("disk full");
    };
    const err = await run(storage, [
      { key: keyFor(body), bytes: body.length, sha256: sha(body) },
    ]).catch((e: unknown) => e);
    expect((err as Error).message).toBe("disk full");
    expect(storage.objects.size).toBe(0);
  });
});
