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
  it("refuses a tiny entry that inflates absurdly (compression ratio) with the default limits", async () => {
    const bomb = zipArchive([{ name: "files/zeros.bin", data: Buffer.alloc(64 * 1024 * 1024) }]);
    await expect(open(bomb)).rejects.toBeInstanceOf(UnsafePackageError);
  });
  it("accepts a well-compressed but ordinary JSON entry", async () => {
    const json = JSON.stringify(
      Array.from({ length: 20_000 }, (_, i) => ({ id: i, n: `row ${i}` })),
    );
    const pkg = await open(zipArchive([{ name: "data/a.json", data: json }]));
    expect((await pkg.text("data/a.json")).length).toBe(json.length);
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
    await expect(pkg.text("data/a.json")).rejects.toThrow();
    pkg.close();
  });
  it("stops a lying entry on the streamed bytes of a capped read", async () => {
    const lying = zipArchive([
      { name: "data/a.json", data: Buffer.alloc(5 * 1024 * 1024, 65), declaredSize: 10 },
    ]);
    const pkg = await open(lying, { ...DEFAULT_PACKAGE_LIMITS, jsonBytes: 1024 });
    await expect(pkg.text("data/a.json")).rejects.toThrow();
    pkg.close();
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
