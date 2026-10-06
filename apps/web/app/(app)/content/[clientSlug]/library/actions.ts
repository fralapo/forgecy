"use server";

import "../../_lib/ports";

import { importProductImage, productSource } from "@forgecy/content";
import { assertCan, ForgecyError, PermissionDeniedError, type Actor } from "@forgecy/core";
import { getDb, type Database } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
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
        error: "You don't have permission for this action.",
        code: "PERM-DENIED",
      };
    if (err instanceof ForgecyError) return { ok: false, error: err.message, code: err.code };
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
      throw new ForgecyError("not_found", "Product or image not found among the approved ones");
    const { row, created } = await importProductImage(db, getStorage(), actor, {
      clientId,
      productId: product.id,
      storageKey: img.storageKey,
      alt: img.alt || product.name,
    });
    return { id: row.id, created };
  });
}
