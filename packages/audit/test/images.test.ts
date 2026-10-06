import { Readable } from "node:stream";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildIndex, verifyEvidence } from "../src/ai/evidence";
import { MAX_VISION_SCREENSHOTS, screenshotImages, toVisionImage } from "../src/handlers/images";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 80, b: 20, alpha: 1 } } })
    .png()
    .toBuffer();

describe("screenshots for vision", () => {
  it("downscales and re-encodes as JPEG", async () => {
    const out = await toVisionImage(new Uint8Array(await png(3000, 6000)));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1568);
    expect(out.byteLength).toBeLessThan(3_750_000);
  });

  it("skips unreadable files and caps the number sent", async () => {
    const good = await png(400, 800);
    const storage = {
      get: async (key: string) =>
        Readable.from([key === "bad" ? Buffer.from("not an image") : good]),
    } as unknown as StorageDriver;
    const sources = [
      { id: "s0", storageKey: "bad" },
      { id: "s1", storageKey: null },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `ok${i}`, storageKey: `k${i}` })),
    ];
    const images = await screenshotImages(storage, sources);
    expect(images).toHaveLength(MAX_VISION_SCREENSHOTS);
    expect(images[0]).toMatchObject({
      sourceId: "ok0",
      image: { mimeType: "image/jpeg", id: "k0" },
    });
  });

  it("keeps screenshot references as evidence", () => {
    const v = verifyEvidence(
      [{ ref: "img:1" }, { ref: "IMG:9" }],
      buildIndex([
        ["IMG:1", { type: "screenshot", label: "Instagram · screenshot", sourceId: "s1" }],
      ]),
    );
    expect(v.evidence).toEqual([
      { type: "screenshot", label: "Instagram · screenshot", sourceId: "s1" },
    ]);
    expect(v.dropped).toEqual(["IMG:9"]);
  });
});
