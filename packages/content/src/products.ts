/**
 * Products from the catalog (packages/catalog, spec pages 71–74). Content never
 * imports the catalog: the apps register a ProductSource that reads *approved*
 * products, and without one the product pickers stay empty. Links are plain ids
 * (no foreign key), so strategy and carousels work with or without the catalog.
 */
import {
  and,
  contentPillars,
  contentPlanItems,
  contentPlans,
  contentRubrics,
  contents,
  eq,
  ne,
  sql,
  type Database,
} from "@forgecy/db";

export interface ProductImageRef {
  /** Storage key under `clients/<id>/`, usable as a slide image. */
  storageKey: string;
  alt: string;
}

/** What strategy and carousels need from an approved product. */
export interface ProductSummary {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  /** Price as written in the catalog; offered to the copy only when the brief allows it. */
  price: string | null;
  description: string;
  /** Benefits, features, use cases, as short lines. */
  highlights: string[];
  /** Bumped by the catalog on every approved change («Il prodotto è cambiato»). */
  revision: number;
  images: ProductImageRef[];
}

export interface ProductSource {
  /** Approved products of a client, by name. */
  listApproved(db: Database, clientId: string): Promise<ProductSummary[]>;
  /** One approved product, or null when missing, not approved or of another client. */
  get(db: Database, clientId: string, productId: string): Promise<ProductSummary | null>;
}

/** Default until the catalog is wired: no products. */
export const noProducts: ProductSource = {
  async listApproved() {
    return [];
  },
  async get() {
    return null;
  },
};

let source: ProductSource = noProducts;

/** Called once at startup by apps/web and apps/worker when the catalog is installed. */
export function setProductSource(s: ProductSource): void {
  source = s;
}

export function productSource(): ProductSource {
  return source;
}

export function hasProductCatalog(): boolean {
  return source !== noProducts;
}

/** Keep only ids of approved products of the client (a proposal may cite stale ones). */
export async function filterApprovedProductIds(
  db: Database,
  clientId: string,
  ids: readonly string[],
): Promise<string[]> {
  if (!ids.length) return [];
  const approved = new Set((await source.listApproved(db, clientId)).map((p) => p.id));
  return [...new Set(ids)].filter((id) => approved.has(id));
}

export interface ProductUsage {
  pillars: { id: string; name: string; status: string }[];
  rubrics: { id: string; name: string; status: string; pillarId: string }[];
  planItems: {
    id: string;
    day: number;
    theme: string;
    planId: string;
    planNumber: number;
    planStatus: string;
  }[];
  contents: { id: string; title: string; status: string; productRevision: number | null }[];
  total: number;
}

/**
 * Where a product is used (the catalog's «Usato in»): pillars, rubrics, items of the
 * active or proposed plan, carousels. Archived and rejected items are left out.
 * Read-only and scoped to the client; the caller checks the `view` permission.
 */
export async function listProductUsage(
  db: Database,
  clientId: string,
  productId: string,
): Promise<ProductUsage> {
  const has = (col: unknown) => sql`${productId}::uuid = any(${col})`;
  const live = (col: unknown) => sql`${col} in ('proposed', 'accepted')`;

  const [pillars, rubrics, planItems, carousels] = await Promise.all([
    db
      .select({ id: contentPillars.id, name: contentPillars.name, status: contentPillars.status })
      .from(contentPillars)
      .where(
        and(
          eq(contentPillars.clientId, clientId),
          has(contentPillars.productIds),
          live(contentPillars.status),
        ),
      )
      .orderBy(contentPillars.name),
    db
      .select({
        id: contentRubrics.id,
        name: contentRubrics.name,
        status: contentRubrics.status,
        pillarId: contentRubrics.pillarId,
      })
      .from(contentRubrics)
      .where(
        and(
          eq(contentRubrics.clientId, clientId),
          has(contentRubrics.productIds),
          live(contentRubrics.status),
        ),
      )
      .orderBy(contentRubrics.name),
    db
      .select({
        id: contentPlanItems.id,
        day: contentPlanItems.day,
        theme: contentPlanItems.theme,
        planId: contentPlans.id,
        planNumber: contentPlans.number,
        planStatus: contentPlans.status,
      })
      .from(contentPlanItems)
      .innerJoin(contentPlans, eq(contentPlans.id, contentPlanItems.planId))
      .where(
        and(
          eq(contentPlanItems.clientId, clientId),
          has(contentPlanItems.productIds),
          live(contentPlanItems.status),
          ne(contentPlans.status, "superseded"),
        ),
      )
      .orderBy(contentPlans.number, contentPlanItems.day),
    db
      .select({
        id: contents.id,
        title: contents.title,
        status: contents.status,
        productRevision: contents.productRevision,
      })
      .from(contents)
      .where(
        and(
          eq(contents.clientId, clientId),
          eq(contents.productId, productId),
          ne(contents.status, "archived"),
        ),
      )
      .orderBy(contents.title),
  ]);
  return {
    pillars,
    rubrics,
    planItems,
    contents: carousels,
    total: pillars.length + rubrics.length + planItems.length + carousels.length,
  };
}
