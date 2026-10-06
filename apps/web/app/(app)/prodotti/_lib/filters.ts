import type { CatalogFilters } from "@forgecy/catalog";
import { productStatuses, type ProductStatus } from "@forgecy/core";

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Reads the catalog query string (?q, ?status, ?category, ?source, ?completeness, ?import, ?sort, ?page). */
export function parseCatalogFilters(p: Params): CatalogFilters & { view: "table" | "grid" } {
  const status = (one(p.status) ?? "")
    .split(",")
    .filter((s): s is ProductStatus => (productStatuses as readonly string[]).includes(s));
  const source = one(p.source);
  const completeness = one(p.completeness);
  const sort = one(p.sort);
  const uuid = /^[0-9a-f-]{36}$/i;
  return {
    q: one(p.q)?.slice(0, 200),
    status: status.length ? status : undefined,
    category: one(p.category)?.slice(0, 120),
    source:
      source && ["csv", "pdf", "zip", "image", "manual", "xlsx", "text", "ai"].includes(source)
        ? (source as CatalogFilters["source"])
        : undefined,
    completeness:
      completeness === "complete" || completeness === "partial" || completeness === "minimal"
        ? completeness
        : undefined,
    importId: uuid.test(one(p.import) ?? "") ? one(p.import) : undefined,
    sort: sort === "updated" || sort === "status" ? sort : "name",
    page: Math.max(1, Number.parseInt(one(p.page) ?? "1", 10) || 1),
    view: one(p.view) === "grid" ? "grid" : "table",
  };
}

/** Query string without page/view, for export links and «Azzera filtri». */
export function filtersQuery(p: Params, drop: string[] = []): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    const value = one(v);
    if (value && !drop.includes(k)) q.set(k, value);
  }
  return q.toString();
}
