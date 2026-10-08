import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { zipArchive } from "@forgecy/core/testing/archives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PACKAGE_LIMITS, openClientPackage } from "../src/package";
import { UnsafePackageError, verifiedChunks } from "../src/safety";

describe("openClientPackage limits", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "forgecy-pkg-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const open = (zip: Buffer, limits = DEFAULT_PACKAGE_LIMITS) => {
    const file = join(dir, "p.zip");
    writeFileSync(file, zip);
    return openClientPackage(file, limits);
  };

  it("reads a normal package", async () => {
    const pkg = await open(zipArchive([{ name: "manifest.json", data: "{}" }]));
    expect(await pkg.text("manifest.json")).toBe("{}");
    pkg.close();
  });
  it("refuses more entries than the limit", async () => {
    const many = zipArchive(
      Array.from({ length: 11 }, (_, i) => ({ name: `data/t${i}.json`, data: "[]" })),
    );
    await expect(open(many, { ...DEFAULT_PACKAGE_LIMITS, entries: 10 })).rejects.toBeInstanceOf(
      UnsafePackageError,
    );
  });
  it("refuses a declared uncompressed total over the limit (honest zip bomb)", async () => {
    const bomb = zipArchive([{ name: "data/clients.json", data: Buffer.alloc(8 * 1024 * 1024) }]);
    await expect(
      open(bomb, { ...DEFAULT_PACKAGE_LIMITS, uncompressedBytes: 1024 * 1024 }),
    ).rejects.toBeInstanceOf(UnsafePackageError);
  });
  // The ratio is for the whole package: a few MB of repetitive text is legitimate.
  it("accepts a highly compressible entry of several MB (a backup must stay restorable)", async () => {
    const blob = JSON.stringify({ svg: "<rect/>".repeat(4000) });
    const rows = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i, blob })));
    expect(rows.length).toBeGreaterThan(5 * 1024 * 1024);
    const zip = zipArchive([{ name: "data/a.json", data: rows }]);
    // far beyond the 200:1 a per-entry check would have allowed
    expect(rows.length / zip.length).toBeGreaterThan(200);
    const pkg = await open(zip);
    expect((await pkg.text("data/a.json")).length).toBe(rows.length);
    pkg.close();
  });
  it("refuses a package that inflates beyond max(floor, ratio x archive size) (declared)", async () => {
    // 64 MiB of zeros in a ~64 KB archive; the floor is lowered so the test needs no GiB of RAM
    const bomb = zipArchive([{ name: "files/zeros.bin", data: Buffer.alloc(64 * 1024 * 1024) }]);
    const tight = { ...DEFAULT_PACKAGE_LIMITS, ratioFloorBytes: 1024 * 1024, ratio: 200 };
    expect(bomb.length * 200).toBeLessThan(64 * 1024 * 1024);
    await expect(open(bomb, tight)).rejects.toBeInstanceOf(UnsafePackageError);
    // the same archive is fine when the floor allows its size
    const pkg = await open(bomb, { ...tight, ratioFloorBytes: 128 * 1024 * 1024 });
    pkg.close();
  });
  it("applies the 1 GiB floor and the absolute ceiling by default", async () => {
    expect(DEFAULT_PACKAGE_LIMITS.ratioFloorBytes).toBe(1024 ** 3);
    expect(DEFAULT_PACKAGE_LIMITS.uncompressedBytes).toBe(20 * 1024 ** 3);
    const pkg = await open(
      zipArchive([{ name: "files/zeros.bin", data: Buffer.alloc(64 * 1024 * 1024) }]),
    );
    pkg.close();
  });
  it("refuses to read a JSON entry over its limit", async () => {
    const pkg = await open(zipArchive([{ name: "data/a.json", data: "x".repeat(200) }]), {
      ...DEFAULT_PACKAGE_LIMITS,
      jsonBytes: 100,
    });
    await expect(pkg.text("data/a.json")).rejects.toBeInstanceOf(UnsafePackageError);
    pkg.close();
  });
  it("never yields more bytes than the entry declares (lying central directory)", async () => {
    const lying = zipArchive([
      { name: "data/a.json", data: Buffer.alloc(5 * 1024 * 1024, 65), declaredSize: 10 },
    ]);
    const pkg = await open(lying);
    const err = await pkg.text("data/a.json").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/too many bytes in the stream/);
    pkg.close();
  });
  it("a lying entry also fails a capped read and a checksum read", async () => {
    const lying = zipArchive([
      { name: "data/a.json", data: Buffer.alloc(5 * 1024 * 1024, 65), declaredSize: 10 },
    ]);
    const pkg = await open(lying, { ...DEFAULT_PACKAGE_LIMITS, jsonBytes: 1024 });
    await expect(pkg.text("data/a.json")).rejects.toThrow(/too many bytes in the stream/);
    await expect(pkg.sha256("data/a.json")).rejects.toThrow(/too many bytes in the stream/);
    pkg.close();
  });
  describe("JSON budgets", () => {
    const MIB = 1024 * 1024;
    it("default per-entry cap is 64 MiB and the total is 256 MiB", () => {
      expect(DEFAULT_PACKAGE_LIMITS.jsonBytes).toBe(64 * MIB);
      expect(DEFAULT_PACKAGE_LIMITS.jsonTotalBytes).toBe(256 * MIB);
    });
    it("refuses an entry over 64 MiB with the default limits, before inflating it", async () => {
      const pkg = await open(
        zipArchive([{ name: "data/big.json", data: Buffer.alloc(65 * MIB, 97) }]),
      );
      const err = await pkg.text("data/big.json").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnsafePackageError);
      expect((err as Error).message).toMatch(/too large/);
      pkg.close();
    });
    it("refuses more JSON text in total than the budget, counting each entry once", async () => {
      const pkg = await open(
        zipArchive([
          { name: "data/a.json", data: "a".repeat(100) },
          { name: "data/b.json", data: "b".repeat(100) },
          { name: "data/c.json", data: "c".repeat(100) },
        ]),
        { ...DEFAULT_PACKAGE_LIMITS, jsonBytes: 150, jsonTotalBytes: 250 },
      );
      await pkg.text("data/a.json");
      await pkg.text("data/a.json"); // read again: not new text
      await pkg.text("data/b.json");
      const err = await pkg.text("data/c.json").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnsafePackageError);
      expect((err as Error).message).toMatch(/JSON/);
      await pkg.text("data/a.json"); // already counted, still readable
      pkg.close();
    });
  });
  it("does not count an entry twice when it is read again (verify then import)", async () => {
    const pkg = await open(
      zipArchive([
        { name: "files/a.bin", data: Buffer.alloc(300, 1) },
        { name: "files/b.bin", data: Buffer.alloc(300, 2) },
      ]),
      { ...DEFAULT_PACKAGE_LIMITS, uncompressedBytes: 700 },
    );
    for (const name of ["files/a.bin", "files/a.bin", "files/b.bin", "files/a.bin", "files/b.bin"])
      expect((await pkg.sha256(name)).length).toBe(64);
    pkg.close();
  });

  describe("entry names", () => {
    const names = [
      "../evil.json",
      "data/../../evil.json",
      "/abs.json",
      "C:/x.json",
      "a\\b.json",
      "a\0b.json",
      "a//b.json",
      "./a.json",
    ];
    for (const name of names)
      it(`refuses ${JSON.stringify(name)}`, async () => {
        await expect(open(zipArchive([{ name, data: "{}" }]))).rejects.toBeInstanceOf(
          UnsafePackageError,
        );
      });
    it("refuses a name repeated (the second would shadow the first)", async () => {
      const dup = zipArchive([
        { name: "data/a.json", data: "[1]" },
        { name: "data/a.json", data: "[2]" },
      ]);
      await expect(open(dup)).rejects.toBeInstanceOf(UnsafePackageError);
    });
    it("refuses two spellings of one name (backslash vs slash)", async () => {
      const dup = zipArchive([
        { name: "data/a.json", data: "[1]" },
        { name: "data\\a.json", data: "[2]" },
      ]);
      await expect(open(dup)).rejects.toBeInstanceOf(UnsafePackageError);
    });
    it("accepts directory entries and ordinary names", async () => {
      const pkg = await open(
        zipArchive([
          { name: "data/", data: "" },
          { name: "files/clients/x/a-b_c.png", data: "p" },
        ]),
      );
      expect(pkg.names()).toEqual(["files/clients/x/a-b_c.png"]);
      pkg.close();
    });
  });
});

describe("verifiedChunks", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const drain = async (g: AsyncIterable<Buffer>) => {
    const out: Buffer[] = [];
    for await (const c of g) out.push(c);
    return Buffer.concat(out);
  };
  const body = Buffer.from("hello world");

  it("passes a stream whose size and checksum match", async () => {
    const out = await drain(
      verifiedChunks(Readable.from([body]), { sha256: sha(body), bytes: body.length }),
    );
    expect(out.equals(body)).toBe(true);
  });
  it("fails when the bytes differ from the manifest checksum", async () => {
    await expect(
      drain(
        verifiedChunks(Readable.from([body]), {
          sha256: sha(Buffer.from("other")),
          bytes: body.length,
        }),
      ),
    ).rejects.toBeInstanceOf(UnsafePackageError);
  });
  it("fails as soon as the stream is longer than declared", async () => {
    await expect(
      drain(verifiedChunks(Readable.from([body, body]), { sha256: sha(body), bytes: body.length })),
    ).rejects.toBeInstanceOf(UnsafePackageError);
  });
  it("fails when the stream is shorter than declared", async () => {
    await expect(
      drain(verifiedChunks(Readable.from([body]), { sha256: sha(body), bytes: body.length + 1 })),
    ).rejects.toBeInstanceOf(UnsafePackageError);
  });
});
