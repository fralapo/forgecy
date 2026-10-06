/**
 * Contrast measured on the render pixels (spec Page 46: "Contrast measured on the render
 * pixels, also over images"). For each text slot the rectangle of the screenshot
 * is reduced to color buckets: the most common one is the dominant background, the
 * text color is the bucket that contrasts most with it, and the background reported
 * is the *worst* sizable bucket behind the text, so text over a photo is judged on
 * its weakest area. Server only (decodes PNG with pngjs).
 */
import { PNG } from "pngjs";
import { checkContrast } from "@forgecy/ui/tokens";
import type { ContrastSample, RenderSlot } from "./types";

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8Array;
}

interface Bucket {
  n: number;
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const bucketHex = (k: Bucket) => toHex(k.r / k.n, k.g / k.n, k.b / k.n);

/** At most this many pixels are read per slot; larger rectangles are sampled on a grid. */
const MAX_SAMPLES = 40_000;

export function sampleSlotContrast(
  image: RgbaImage,
  rect: RenderSlot["rect"],
): { fgHex: string; bgHex: string; point: { x: number; y: number } } | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_SAMPLES)));
  const buckets = new Map<number, Bucket>();
  let total = 0;
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i]!;
      const g = image.data[i + 1]!;
      const b = image.data[i + 2]!;
      // 4 bits per channel: anti-aliased edges fall in their own small buckets.
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0, x, y };
      k.n++;
      k.r += r;
      k.g += g;
      k.b += b;
      buckets.set(key, k);
      total++;
    }
  const list = [...buckets.values()].sort((a, b) => b.n - a.n);
  const dominant = list[0]!;
  const dominantHex = bucketHex(dominant);
  const fg = list
    .filter((k) => k !== dominant && k.n / total >= 0.01)
    .map((k) => ({ k, ratio: checkContrast(bucketHex(k), dominantHex) }))
    .sort((a, b) => b.ratio - a.ratio)[0]?.k;
  if (!fg)
    return { fgHex: dominantHex, bgHex: dominantHex, point: { x: dominant.x, y: dominant.y } };
  const fgHex = bucketHex(fg);
  // Background areas: every sizable bucket other than the text, however close to it.
  const worst =
    list
      .filter((k) => k !== fg && k.n / total >= 0.05)
      .map((k) => ({ k, ratio: checkContrast(bucketHex(k), fgHex) }))
      .sort((a, b) => a.ratio - b.ratio)[0]?.k ?? dominant;
  return { fgHex, bgHex: bucketHex(worst), point: { x: worst.x, y: worst.y } };
}

export function decodePng(png: Uint8Array): RgbaImage {
  const img = PNG.sync.read(Buffer.from(png));
  return { width: img.width, height: img.height, data: new Uint8Array(img.data) };
}

/**
 * Contrast samples for every text slot of one rendered slide, ready for
 * `GuardRender.slides[].contrast`. `slots` are the renderer's measures of that slide.
 */
export function sampleContrastFromPng(
  png: Uint8Array,
  slots: readonly Pick<RenderSlot, "name" | "kind" | "rect">[],
): ContrastSample[] {
  const image = decodePng(png);
  const out: ContrastSample[] = [];
  for (const s of slots) {
    if (s.kind !== "text") continue;
    const sample = sampleSlotContrast(image, s.rect);
    if (sample) out.push({ slot: s.name, ...sample });
  }
  return out;
}
