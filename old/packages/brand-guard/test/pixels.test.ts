import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { sampleContrastFromPng, sampleSlotContrast, type RgbaImage } from "../src/pixels";

type Rgb = [number, number, number];

function image(width: number, height: number, paint: (x: number, y: number) => Rgb): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

/** Horizontal "text" strokes: every fourth row inside the slot is the text color. */
const stroke = (y: number) => y % 4 === 0;

describe("contrast on the render pixels", () => {
  it("finds text and background on a flat color", () => {
    const img = image(200, 100, (_x, y) => (stroke(y) ? [26, 26, 26] : [255, 255, 255]));
    expect(sampleSlotContrast(img, { x: 0, y: 0, width: 200, height: 100 })).toMatchObject({
      fgHex: "#1A1A1A",
      bgHex: "#FFFFFF",
    });
  });

  it("judges text over a photo on its weakest area", () => {
    // White text; the background is half dark, half light gray.
    const img = image(200, 100, (x, y) =>
      stroke(y) ? [255, 255, 255] : x < 100 ? [30, 30, 30] : [200, 200, 200],
    );
    const s = sampleSlotContrast(img, { x: 0, y: 0, width: 200, height: 100 })!;
    expect(s.fgHex).toBe("#FFFFFF");
    expect(s.bgHex).toBe("#C8C8C8");
    expect(s.point.x).toBeGreaterThanOrEqual(100);
  });

  it("returns null for a slot outside the image", () => {
    const img = image(10, 10, () => [0, 0, 0]);
    expect(sampleSlotContrast(img, { x: 20, y: 20, width: 5, height: 5 })).toBeNull();
  });

  it("decodes a PNG screenshot and samples only text slots", () => {
    const png = new PNG({ width: 50, height: 50 });
    for (let i = 0; i < 50 * 50; i++)
      png.data.set(i % 200 < 50 ? [0, 0, 0, 255] : [250, 250, 250, 255], i * 4);
    const bytes = new Uint8Array(PNG.sync.write(png));
    const samples = sampleContrastFromPng(bytes, [
      { name: "title", kind: "text", rect: { x: 0, y: 0, width: 50, height: 50 } },
      { name: "photo", kind: "image", rect: { x: 0, y: 0, width: 50, height: 50 } },
    ]);
    expect(samples).toEqual([
      expect.objectContaining({ slot: "title", fgHex: "#000000", bgHex: "#FAFAFA" }),
    ]);
  });
});
