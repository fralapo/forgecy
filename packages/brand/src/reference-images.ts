/**
 * The client's own pictures, ready to go with an image request as visual references: the
 * model matches their palette, light and product look. Only what a person attested the
 * rights of (approved, taken from the client's website); never drafts, logos or social
 * profile pictures.
 */
import type { InputImage } from "@forgecy/ai";
import { assertCan, type Actor } from "@forgecy/core";
import { and, assets, desc, eq, inArray, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import sharp from "sharp";
import { brandImageClass, type BrandImageClass } from "./read";

/** Longest side sent to the model; the references steer style, they do not need detail. */
export const REFERENCE_MAX_SIDE = 768;
/** Most bytes of one reference, the gateway refuses more. */
export const REFERENCE_MAX_BYTES = 1_500_000;
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** Candidates in the order they are tried: a product shot says most about the brand. */
const CLASSES = ["product", "scene", "graphic"] as const satisfies readonly BrandImageClass[];
/** SVG is left out on purpose: it is not a photo and the models do not take it. */
const MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

async function readCapped(
  stream: AsyncIterable<unknown> & { destroy?: () => unknown },
  max: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const c of stream) {
      const b = Buffer.from(c as Uint8Array);
      size += b.byteLength;
      if (size > max) throw new Error("file too large");
      chunks.push(b);
    }
  } finally {
    // Stop downloading a file that is over the cap instead of leaving the socket open.
    stream.destroy?.();
  }
  return Buffer.concat(chunks);
}

async function toReference(bytes: Uint8Array, id: string): Promise<InputImage | null> {
  const data = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(REFERENCE_MAX_SIDE, REFERENCE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
  if (data.byteLength > REFERENCE_MAX_BYTES) return null;
  return { data: new Uint8Array(data), mimeType: "image/jpeg", id };
}

/**
 * Up to `limit` references: product pictures first, then scenes, then graphics, one of each
 * class before a second of the same one. A picture that cannot be read or decoded is
 * skipped, never fatal: the image is then made with fewer references.
 */
export async function brandReferenceImages(
  db: Database,
  storage: StorageDriver,
  actor: Actor,
  clientId: string,
  limit = 4,
): Promise<InputImage[]> {
  assertCan(actor, "view", clientId);
  const rows = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.clientId, clientId),
        eq(assets.source, "site"),
        eq(assets.status, "approved"),
        inArray(assets.mime, MIMES),
      ),
    )
    .orderBy(desc(assets.createdAt))
    .limit(200);
  const byClass = new Map<string, typeof rows>(CLASSES.map((c) => [c, []]));
  for (const row of rows) {
    const cls = brandImageClass(row.tags);
    // Same rule as the content library's commercial use of a site image: a person confirmed
    // the rights. (@forgecy/content depends on this package, so it is not imported from there.)
    if (cls && !row.tags.includes("social") && row.rights != null) byClass.get(cls)?.push(row);
  }
  const order: typeof rows = [];
  for (let i = 0; order.length < rows.length; i++) {
    const before = order.length;
    for (const c of CLASSES) {
      const row = byClass.get(c)?.[i];
      if (row) order.push(row);
    }
    if (order.length === before) break;
  }

  const out: InputImage[] = [];
  for (const row of order) {
    if (out.length >= limit) break;
    if (row.size > MAX_SOURCE_BYTES) continue;
    try {
      const bytes = await readCapped(await storage.get(row.storageKey), MAX_SOURCE_BYTES);
      const ref = await toReference(bytes, row.id);
      if (ref) out.push(ref);
    } catch {
      // Missing file, corrupt image or decompression bomb: this picture is just not used.
    }
  }
  return out;
}
