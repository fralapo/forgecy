import { listProducts, loadCatalogClient, productsToCsv, type CatalogRow } from "@forgecy/catalog";
import { clients, eq, getDb } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { withUser } from "@/lib/api";
import { csvLabels } from "../../_lib/labels";
import { parseCatalogFilters } from "../../_lib/filters";

export const dynamic = "force-dynamic";

/** “Export CSV” of the filtered products in the exporter's language (formulas neutralized, `;` for Excel). */
export const GET = withUser(
  async (_user, request: Request, { params }: { params: Promise<{ clientSlug: string }> }) => {
    const { clientSlug } = await params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client) return new Response("Not found", { status: 404 });
    await loadCatalogClient(db, client.id);
    const filters = parseCatalogFilters(Object.fromEntries(new URL(request.url).searchParams));
    const rows: CatalogRow[] = [];
    for (let page = 1; ; page++) {
      const r = await listProducts(db, client.id, { ...filters, page });
      rows.push(...r.rows);
      if (page >= r.pages || page >= 200) break;
    }
    const t = await getTranslations("products");
    return new Response(productsToCsv(rows, csvLabels(t)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="products-${client.slug}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
);
