/**
 * Server-side wiring of the content module's ports: the product catalog (approved
 * products and their approved photos) and the Brand Guard. The worker and the web
 * app import this once; tests register their own fakes instead.
 */
import { confirmBrandCheckForApproval, getBrandCheck, runBrandCheck } from "@forgecy/brand-guard";
import { approvedProducts } from "@forgecy/catalog";
import { and, eq, productFacts, products, type Database } from "@forgecy/db";
import { setBrandGuard } from "./carousels/brand-guard";
import { setProductSource, type ProductSource, type ProductSummary } from "./products";

type CatalogProduct = Awaited<ReturnType<typeof approvedProducts>>[number];

function summary(
  p: CatalogProduct,
  revision: number,
  facts: ProductSummary["facts"] = [],
): ProductSummary {
  const f = p.fields;
  return {
    id: p.id,
    name: f.name,
    sku: f.sku || null,
    category: f.category || null,
    price: f.price ? `${f.price}${f.currency ? ` ${f.currency}` : ""}` : null,
    description: [f.shortDescription, f.longDescription].filter(Boolean).join("\n\n"),
    highlights: [...f.benefits, ...f.features, ...f.usage].filter(Boolean).slice(0, 40),
    facts,
    revision,
    images: p.images
      .filter((i) => i.storageKey.startsWith(`clients/${i.clientId}/`))
      .map((i) => ({ storageKey: i.storageKey, alt: i.alt ?? f.name })),
  };
}

async function revisions(db: Database, clientId: string) {
  const rows = await db
    .select({ id: products.id, revision: products.revision })
    .from(products)
    .where(and(eq(products.clientId, clientId), eq(products.status, "approved")));
  return new Map(rows.map((r) => [r.id, r.revision]));
}

async function factsByProduct(db: Database, clientId: string) {
  const rows = await db.select().from(productFacts).where(eq(productFacts.clientId, clientId));
  const map = new Map<string, ProductSummary["facts"]>();
  for (const r of rows)
    map.set(r.productId, [
      ...(map.get(r.productId) ?? []),
      { text: r.text, keywords: r.keywords, status: r.status },
    ]);
  return map;
}

export const catalogProductSource: ProductSource = {
  async listApproved(db, clientId) {
    const [list, revs, facts] = await Promise.all([
      approvedProducts(db, clientId),
      revisions(db, clientId),
      factsByProduct(db, clientId),
    ]);
    return list.map((p) => summary(p, revs.get(p.id) ?? 1, facts.get(p.id)));
  },
  async get(db, clientId, productId) {
    const all = await this.listApproved(db, clientId);
    return all.find((p) => p.id === productId) ?? null;
  },
};

let registered = false;

/** Registers the catalog and the Brand Guard as the content module's ports (idempotent). */
export function registerContentPorts(): void {
  if (registered) return;
  registered = true;
  setProductSource(catalogProductSource);
  setBrandGuard({
    run: runBrandCheck,
    get: getBrandCheck,
    confirmForApproval: confirmBrandCheckForApproval,
  });
}
