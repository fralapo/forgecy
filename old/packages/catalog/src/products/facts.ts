/**
 * Fact bank of a product: claims with a trust status and a source. A person edits them
 * (`products.manage`); the content checks and the claim critic read them through
 * @forgecy/content. Product fields (benefits, features, usage) are implicit `catalog_only` facts.
 */
import { assertCan, productFactStatuses, type ProductFactStatus } from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";
import { and, asc, eq, productFacts, recordAuditEvent } from "@forgecy/db";
import { z } from "zod";
import type { ActingUser, DbLike } from "../db";
import { loadProduct } from "./products";

export const factInputSchema = z.object({
  text: z.string().trim().min(1).max(500),
  /** Words that identify the fact in copy besides its text. */
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  status: z.enum(productFactStatuses).default("catalog_only"),
  /** Page or document the fact comes from. */
  source: z.string().trim().max(300).default(""),
});
export type FactInput = z.input<typeof factInputSchema>;

export type ProductFactRow = typeof productFacts.$inferSelect;

/** "a, b ; c" → ["a", "b", "c"]: how the keywords field is typed. */
export function splitKeywords(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
}

export async function listProductFacts(
  db: DbLike,
  clientId: string,
  productId: string,
): Promise<ProductFactRow[]> {
  return db
    .select()
    .from(productFacts)
    .where(and(eq(productFacts.clientId, clientId), eq(productFacts.productId, productId)))
    .orderBy(asc(productFacts.createdAt));
}

/** Add a fact (no `factId`) or change one. */
export async function saveProductFact(
  db: DbLike,
  user: ActingUser,
  input: { clientId: string; productId: string; factId?: string; fact: FactInput },
): Promise<ProductFactRow> {
  assertCan(user.actor, "products.manage", input.clientId);
  const fact = factInputSchema.parse(input.fact);
  await loadProduct(db, input.clientId, input.productId);
  let row: ProductFactRow | undefined;
  if (input.factId) {
    [row] = await db
      .update(productFacts)
      .set({ ...fact, updatedBy: user.id })
      .where(
        and(
          eq(productFacts.id, input.factId),
          eq(productFacts.clientId, input.clientId),
          eq(productFacts.productId, input.productId),
        ),
      )
      .returning();
  } else {
    [row] = await db
      .insert(productFacts)
      .values({
        ...fact,
        clientId: input.clientId,
        productId: input.productId,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
  }
  if (!row) throw localizedError("not_found", "products.errors.factNotFound");
  await recordAuditEvent(db, {
    actor: user.actor,
    action: input.factId ? "product.fact_update" : "product.fact_add",
    entity: "product",
    entityId: input.productId,
    clientId: input.clientId,
    meta: { factId: row.id, status: row.status as ProductFactStatus },
  });
  return row;
}

export async function deleteProductFact(
  db: DbLike,
  user: ActingUser,
  input: { clientId: string; productId: string; factId: string },
): Promise<void> {
  assertCan(user.actor, "products.manage", input.clientId);
  const gone = await db
    .delete(productFacts)
    .where(
      and(
        eq(productFacts.id, input.factId),
        eq(productFacts.clientId, input.clientId),
        eq(productFacts.productId, input.productId),
      ),
    )
    .returning({ id: productFacts.id });
  if (!gone.length) throw localizedError("not_found", "products.errors.factNotFound");
  await recordAuditEvent(db, {
    actor: user.actor,
    action: "product.fact_delete",
    entity: "product",
    entityId: input.productId,
    clientId: input.clientId,
    meta: { factId: input.factId },
  });
}
