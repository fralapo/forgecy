import { overlappingZip, zipArchive } from "@forgecy/core/testing/archives";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { unzipTemplatePackage } from "../src/node";
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES } from "../src/package";
import { validateTemplatePackage } from "../src/validate";
import { loadRepoTemplate } from "./helpers";

// A template ZIP also arrives inside a client package (system/templates/<sha>.zip) and is
// unzipped by the web render route: every number it declares is a lie until counted.
const messageOf = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e as Error & { code?: string },
  );
  return err && { code: err.code, message: err.message };
};

describe("unzipTemplatePackage", () => {
  it("unpacks a zipped repository template, folder stripped and hidden files skipped", async () => {
    const pkg = await loadRepoTemplate("carousels/editorial-ig-4x5");
    const zipped: Record<string, Uint8Array> = {};
    for (const [k, v] of pkg.files) zipped[`editorial/${k}`] = v;
    zipped["editorial/.DS_Store"] = new Uint8Array([1]);
    zipped["__MACOSX/editorial/._template.json"] = new Uint8Array([1]);
    const files = await unzipTemplatePackage(zipSync(zipped));
    expect([...files.keys()].sort()).toEqual([...pkg.files.keys()].sort());
    expect(validateTemplatePackage(files).ok).toBe(true);
  }, 30_000);

  it("refuses an unsafe path", async () => {
    expect(
      await messageOf(unzipTemplatePackage(zipArchive([{ name: "../evil.txt", data: "x" }]))),
    ).toMatchObject({ code: "validation", message: expect.stringMatching(/not allowed/) });
  });

  it("refuses a stored entry that is far larger than it claims", async () => {
    const lying = zipArchive([
      {
        name: "template.json",
        data: Buffer.alloc(1024 * 1024, 0x20),
        store: true,
        declaredSize: 10,
      },
    ]);
    expect(await messageOf(unzipTemplatePackage(lying))).toMatchObject({ code: "validation" });
  });

  it("refuses a bomb that lies about its size", async () => {
    const bomb = zipArchive([
      { name: "template.json", data: Buffer.alloc(MAX_PACKAGE_BYTES + 1), declaredSize: 10 },
    ]);
    expect(await messageOf(unzipTemplatePackage(bomb))).toMatchObject({ code: "validation" });
  });

  it("refuses overlapping entries that inflate one body many times", async () => {
    const overlap = overlappingZip({
      data: Buffer.alloc(4 * 1024 * 1024),
      entries: 20,
      declaredSize: 10,
      name: (i) => `f${i}.bin`,
    });
    expect(await messageOf(unzipTemplatePackage(overlap))).toMatchObject({ code: "validation" });
  });

  it("refuses too many entries", async () => {
    const many = zipArchive(
      Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })),
    );
    expect(await messageOf(unzipTemplatePackage(many))).toMatchObject({
      code: "validation",
      message: expect.stringMatching(/too large/i),
    });
  });

  it("refuses bytes that are not a ZIP as unreadable", async () => {
    expect(await messageOf(unzipTemplatePackage(new Uint8Array([1, 2, 3])))).toMatchObject({
      code: "validation",
    });
  });
});
