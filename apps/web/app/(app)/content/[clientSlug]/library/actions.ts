"use server";

import "../../_lib/ports";

import {
  addStockCredit,
  importPexelsPhoto,
  importProductImage,
  productSource,
  searchStock,
} from "@forgecy/content";
import { assertCan, ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { getDb, type Database } from "@forgecy/db";
import { pexelsOrientations } from "@forgecy/files";
import { localizedError } from "@forgecy/i18n";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { ActionResult } from "../../actions";
import { getStorage } from "../../_lib/server";

const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const uuid = z.uuid();

async function run<T extends object>(
  slug: string,
  fn: (ctx: { db: Database; actor: Actor }) => Promise<T>,
): Promise<ActionResult<T>> {
  slugSchema.parse(slug);
  const user = await requireUser();
  try {
    const out = await fn({ db: getDb(), actor: user.actor });
    revalidatePath(`/content/${slug}/library`);
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return {
        ok: false,
        error: (await errorMessage(err)) ?? err.message,
        code: "PERM-DENIED",
      };
    if (err instanceof ForgecyError)
      return { ok: false, error: (await errorMessage(err)) ?? err.message, code: err.code };
    throw err;
  }
}

/**
 * Copy one photo of an approved product into the library. The storage key comes from
 * the product source on the server, never from the browser.
 */
export async function importProductImageAction(input: {
  slug: string;
  clientId: string;
  productId: string;
  image: number;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const clientId = uuid.parse(input.clientId);
    assertCan(actor, "assets.upload", clientId);
    const product = await productSource().get(db, clientId, uuid.parse(input.productId));
    const img = product?.images[z.number().int().min(0).parse(input.image)];
    if (!product || !img)
      throw localizedError("not_found", "content.library.errors.productImageNotFound");
    const { row, created } = await importProductImage(db, getStorage(), actor, {
      clientId,
      productId: product.id,
      storageKey: img.storageKey,
      alt: img.alt || product.name,
    });
    return { id: row.id, created };
  });
}

/** Pexels search; the key is read on the server only and never returned. */
export async function searchPexelsAction(input: {
  slug: string;
  clientId: string;
  query: string;
  orientation: string;
  page?: number;
}) {
  return run(input.slug, async ({ actor }) => {
    const res = await searchStock(actor, {
      clientId: uuid.parse(input.clientId),
      query: z.string().max(200).parse(input.query),
      orientation: z.enum(pexelsOrientations).parse(input.orientation),
      page: z.number().int().min(1).max(100).default(1).parse(input.page),
    });
    if (!res.configured) return { configured: false as const };
    return {
      configured: true as const,
      photos: res.photos.map((p) => ({
        id: p.id,
        url: p.url,
        photographer: p.photographer,
        photographerUrl: p.photographerUrl,
        alt: p.alt,
        avgColor: p.avgColor,
        srcMedium: p.srcMedium,
      })),
      page: res.page,
      total: res.total,
      remaining: res.rateLimit.remaining,
    };
  });
}

/** Download one Pexels photo into the library; the browser sends only the photo id. */
export async function importPexelsPhotoAction(input: {
  slug: string;
  clientId: string;
  photoId: number;
  contentId?: string;
}) {
  return run(input.slug, async ({ db, actor }) => {
    const { row, created, credit } = await importPexelsPhoto(db, getStorage(), actor, {
      clientId: uuid.parse(input.clientId),
      photoId: z.number().int().positive().parse(input.photoId),
      ...(input.contentId ? { contentId: uuid.parse(input.contentId) } : {}),
    });
    return { id: row.id, key: row.storageKey, alt: row.alt, created, credit };
  });
}

/** A stock photo went into a slide: add its credit line to the content. */
export async function addStockCreditAction(input: {
  slug: string;
  clientId: string;
  contentId: string;
  assetId: string;
}) {
  return run(input.slug, async ({ db, actor }) =>
    addStockCredit(db, actor, {
      clientId: uuid.parse(input.clientId),
      id: uuid.parse(input.contentId),
      assetId: uuid.parse(input.assetId),
    }),
  );
}
