import type { InputImage } from "@forgecy/ai";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { readAll } from "../service/social";

/** Screenshots sent with one social analysis (the gateway accepts up to 20). */
export const MAX_VISION_SCREENSHOTS = 8;
/** Gateway limit per image is 3.75 MB; stay well under it. */
const MAX_BYTES = 3_500_000;
/** Longest side: enough to read a profile grid or a caption, small enough to keep costs low. */
const MAX_SIDE = 1568;

/** Downscale and re-encode a screenshot as JPEG for a vision model. */
export async function toVisionImage(bytes: Uint8Array): Promise<Uint8Array> {
  for (const quality of [80, 65, 50]) {
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toBuffer();
    if (out.byteLength <= MAX_BYTES) return new Uint8Array(out);
  }
  throw new Error("Screenshot troppo grande anche dopo la riduzione");
}

/**
 * Load the channel's screenshots for the Brand Analyst, newest first. A file that
 * cannot be read or converted is skipped: the analysis goes on with the others.
 */
export async function screenshotImages(
  storage: StorageDriver,
  sources: Array<{ id: string; storageKey: string | null }>,
): Promise<Array<{ sourceId: string; image: InputImage }>> {
  const out: Array<{ sourceId: string; image: InputImage }> = [];
  for (const s of sources) {
    if (out.length >= MAX_VISION_SCREENSHOTS) break;
    if (!s.storageKey) continue;
    try {
      const data = await toVisionImage(await readAll(await storage.get(s.storageKey)));
      out.push({ sourceId: s.id, image: { data, mimeType: "image/jpeg", id: s.storageKey } });
    } catch {
      continue;
    }
  }
  return out;
}
