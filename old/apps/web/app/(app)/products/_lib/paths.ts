import type { Route } from "next";

/** Typed links of the catalog pages (dynamic segments need a cast with typedRoutes). */
export const paths = {
  catalog: (slug: string, query?: string) =>
    `/products/${slug}${query ? `?${query}` : ""}` as Route,
  product: (slug: string, id: string) => `/products/${slug}/${id}` as Route,
  importNew: (slug: string) => `/products/${slug}/import` as Route,
  importOpen: (slug: string, importId: string) =>
    `/products/${slug}/import?importId=${importId}` as Route,
  review: (slug: string, importId: string, query?: string) =>
    `/products/${slug}/import/${importId}/review${query ? `?${query}` : ""}` as Route,
  upload: (slug: string, importId: string) => `/products/${slug}/import/${importId}/file`,
  discards: (slug: string, importId: string) => `/products/${slug}/import/${importId}/rejected`,
  exportCsv: (slug: string, query: string) => `/products/${slug}/export${query ? `?${query}` : ""}`,
};
