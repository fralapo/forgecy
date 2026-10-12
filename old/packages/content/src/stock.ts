/**
 * Pexels stock photos in the client library. Search is server-side (the key stays in
 * `.env`); an import downloads the photo through the server, stores it like an upload and
 * leaves its rights pending: a person confirms them (basis “licensed”), never the import.
 */
import { type Actor } from "@forgecy/core";
import { recordAuditEvent, type Database } from "@forgecy/db";
import {
  downloadPexelsImage,
  getPexelsPhoto,
  searchPexels,
  type PexelsOptions,
  type PexelsOrientation,
  type StorageDriver,
} from "@forgecy/files";
import { humanOnly, notFound } from "./access";
import { storeAsset } from "./assets";

export const PEXELS_LICENSE_URL = "https://www.pexels.com/license/";

export interface StockMeta {
  provider: "pexels";
  photoId: number;
  pageUrl: string;
  photographer: string;
  photographerUrl: string;
  license: string;
  licenseUrl: string;
}

/** “Photo: <Name> / Pexels”, from the `stock` metadata of an image; null when absent. */
export function stockCreditLine(stock: unknown): string | null {
  const name = (stock as Partial<StockMeta> | null)?.photographer;
  return typeof name === "string" && name.trim() ? `Photo: ${name.trim()} / Pexels` : null;
}

/**
 * Credit lines after a save: the line of a photo that left the carousel goes, unless another
 * slide still uses that photo. Only lines in the generated format of a stock asset match, so
 * lines typed by hand stay. `before` and `after` are the image keys of the two drafts.
 */
export function pruneStockCredits(
  current: readonly string[],
  before: Iterable<string>,
  after: Iterable<string>,
  lineOf: (key: string) => string | null,
): string[] {
  const kept = new Set(after);
  const dropped = new Set<string>();
  for (const key of before) {
    const line = kept.has(key) ? null : lineOf(key);
    if (line) dropped.add(line);
  }
  for (const key of kept) dropped.delete(lineOf(key) ?? "");
  return current.filter((l) => !dropped.has(l));
}

export async function searchStock(
  actor: Actor,
  input: { clientId: string; query: string; orientation?: PexelsOrientation; page?: number },
  o?: PexelsOptions,
) {
  humanOnly(actor, "assets.upload", input.clientId);
  return searchPexels(
    {
      query: input.query,
      ...(input.orientation ? { orientation: input.orientation } : {}),
      ...(input.page ? { page: input.page } : {}),
    },
    o,
  );
}

/** Download a Pexels photo into the client's library (people only; rights stay pending). */
export async function importPexelsPhoto(
  db: Database,
  storage: StorageDriver,
  actor: Actor,
  input: { clientId: string; photoId: number; tags?: string[]; contentId?: string | null },
  o?: PexelsOptions,
) {
  humanOnly(actor, "assets.upload", input.clientId);
  const photo = await getPexelsPhoto(input.photoId, o);
  if (!photo) notFound("content.errors.imageNotFound");
  const { bytes, mime } = await downloadPexelsImage(photo.srcLarge, o);
  const stock: StockMeta = {
    provider: "pexels",
    photoId: photo.id,
    pageUrl: photo.url,
    photographer: photo.photographer,
    photographerUrl: photo.photographerUrl,
    license: "Pexels License (free commercial use, attribution not required)",
    licenseUrl: PEXELS_LICENSE_URL,
  };
  const res = await storeAsset(db, storage, {
    clientId: input.clientId,
    bytes,
    declaredMime: mime,
    source: "stock",
    status: "approved",
    alt: photo.alt || `Photo by ${photo.photographer}`,
    tags: ["stock", "pexels", ...(input.tags ?? [])],
    stock: { ...stock },
    contentId: input.contentId ?? null,
    createdBy: actor.id,
  });
  if (res.created)
    await recordAuditEvent(db, {
      actor,
      action: "content.asset_stock_imported",
      entity: "asset",
      entityId: res.row.id,
      clientId: input.clientId,
      meta: { provider: "pexels", photoId: photo.id },
    });
  return { ...res, credit: stockCreditLine(stock)! };
}
