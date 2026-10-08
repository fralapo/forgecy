import { overlappingZip, zipArchive } from "@forgecy/core/testing/archives";
import { describe, expect, it } from "vitest";
import { listZipNames, readZipParts, validateZipParts, ZipLimitError } from "../src/safe-zip";

const limits = { maxEntries: 100, maxEntryBytes: 1024, maxTotalBytes: 2048 };
const reason = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof ZipLimitError ? e.reason : "error"),
  );

describe("readZipParts", () => {
  it("returns only the selected parts", async () => {
    const zip = zipArchive([
      { name: "a.xml", data: "<a/>" },
      { name: "b.bin", data: "binary" },
    ]);
    const parts = await readZipParts(zip, { ...limits, select: (n) => n.endsWith(".xml") });
    expect([...parts.keys()]).toEqual(["a.xml"]);
    expect(Buffer.from(parts.get("a.xml")!).toString()).toBe("<a/>");
  });

  it("never inflates what is not selected", async () => {
    const zip = zipArchive([
      { name: "a.xml", data: "<a/>" },
      { name: "huge.bin", data: Buffer.alloc(30 * 1024 * 1024) },
    ]);
    const parts = await readZipParts(zip, { ...limits, select: (n) => n === "a.xml" });
    expect(parts.size).toBe(1);
  });

  it("enforces the per-part, total and entry limits", async () => {
    const big = zipArchive([{ name: "a.xml", data: Buffer.alloc(2000) }]);
    expect(await reason(readZipParts(big, { ...limits, select: () => true }))).toBe("entry_bytes");
    const two = zipArchive([
      { name: "a.xml", data: Buffer.alloc(1000) },
      { name: "b.xml", data: Buffer.alloc(1000) },
      { name: "c.xml", data: Buffer.alloc(1000) },
    ]);
    expect(await reason(readZipParts(two, { ...limits, select: () => true }))).toBe("total_bytes");
    const many = zipArchive(Array.from({ length: 101 }, (_, i) => ({ name: `f${i}`, data: "x" })));
    expect(await reason(readZipParts(many, { ...limits, select: () => false }))).toBe("entries");
  });

  it("counts real bytes for entries that overlap, stored or deflated", async () => {
    for (const store of [true, false]) {
      const zip = overlappingZip({
        data: Buffer.alloc(1000, 0x41),
        entries: 50,
        store,
        declaredSize: 1000,
        name: (i) => `p${i}.xml`,
      });
      expect(await reason(readZipParts(zip, { ...limits, select: () => true }))).toBe(
        "total_bytes",
      );
    }
  });

  it("refuses an entry that declares a different size than it has", async () => {
    const lie = zipArchive([{ name: "a.xml", data: Buffer.alloc(500), declaredSize: 10 }]);
    expect(await reason(readZipParts(lie, { ...limits, select: () => true }))).toBe("error");
    const stored = overlappingZip({
      data: Buffer.alloc(500),
      entries: 1,
      store: true,
      declaredSize: 0,
      name: () => "a.xml",
    });
    expect(await reason(readZipParts(stored, { ...limits, select: () => true }))).toBe("error");
  });

  it("stops a deflate bomb long before it is fully inflated", async () => {
    const zip = overlappingZip({
      data: Buffer.alloc(256 * 1024 * 1024),
      entries: 10,
      declaredSize: 256 * 1024 * 1024,
      name: (i) => `p${i}.xml`,
    });
    const t = Date.now();
    expect(
      await reason(
        readZipParts(zip, {
          ...limits,
          maxEntryBytes: 1 << 30,
          maxTotalBytes: 1 << 20,
          select: () => true,
        }),
      ),
    ).toBe("total_bytes");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("listZipNames", () => {
  it("lists names without inflating and caps the entry count", async () => {
    const zip = zipArchive([
      { name: "x.xml", data: Buffer.alloc(30 * 1024 * 1024) },
      { name: "y.xml", data: "y" },
    ]);
    expect(await listZipNames(zip, { maxEntries: 10 })).toEqual(["x.xml", "y.xml"]);
    expect(await reason(listZipNames(zip, { maxEntries: 1 }))).toBe("entries");
  });
});

describe("validateZipParts", () => {
  const all = { ...limits, select: () => true };

  it("accepts a legit archive and keeps nothing", async () => {
    const zip = zipArchive([
      { name: "a.xml", data: Buffer.alloc(500, 65) },
      { name: "b.xml", data: Buffer.alloc(500, 66) },
    ]);
    expect(await validateZipParts(zip, all)).toBeUndefined();
  });

  it("enforces the same limits as readZipParts", async () => {
    const big = zipArchive([{ name: "a.xml", data: Buffer.alloc(2000) }]);
    expect(await reason(validateZipParts(big, all))).toBe("entry_bytes");
    const three = zipArchive(
      ["a", "b", "c"].map((n) => ({ name: `${n}.xml`, data: Buffer.alloc(1000) })),
    );
    expect(await reason(validateZipParts(three, all))).toBe("total_bytes");
    const many = zipArchive(Array.from({ length: 101 }, (_, i) => ({ name: `f${i}`, data: "x" })));
    expect(await reason(validateZipParts(many, { ...all, select: () => false }))).toBe("entries");
  });

  it("still counts real bytes: lying sizes, overlaps and bombs are refused", async () => {
    const lie = zipArchive([{ name: "a.xml", data: Buffer.alloc(500), declaredSize: 10 }]);
    expect(await reason(validateZipParts(lie, all))).toBe("error");
    const overlap = overlappingZip({
      data: Buffer.alloc(1000, 0x41),
      entries: 50,
      store: true,
      declaredSize: 1000,
      name: (i) => `p${i}.xml`,
    });
    expect(await reason(validateZipParts(overlap, all))).toBe("total_bytes");
    const bomb = overlappingZip({
      data: Buffer.alloc(256 * 1024 * 1024),
      entries: 10,
      declaredSize: 256 * 1024 * 1024,
      name: (i) => `p${i}.xml`,
    });
    const t = Date.now();
    expect(
      await reason(
        validateZipParts(bomb, { ...all, maxEntryBytes: 1 << 30, maxTotalBytes: 1 << 20 }),
      ),
    ).toBe("total_bytes");
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
