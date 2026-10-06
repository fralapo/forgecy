import type { Route } from "next";

/** Typed links of the catalog pages (dynamic segments need a cast with typedRoutes). */
export const paths = {
  catalog: (slug: string, query?: string) =>
    `/prodotti/${slug}${query ? `?${query}` : ""}` as Route,
  product: (slug: string, id: string) => `/prodotti/${slug}/${id}` as Route,
  importNew: (slug: string) => `/prodotti/${slug}/importa` as Route,
  importOpen: (slug: string, importId: string) =>
    `/prodotti/${slug}/importa?importId=${importId}` as Route,
  review: (slug: string, importId: string, query?: string) =>
    `/prodotti/${slug}/importa/${importId}/revisione${query ? `?${query}` : ""}` as Route,
  upload: (slug: string, importId: string) => `/prodotti/${slug}/importa/${importId}/file`,
  discards: (slug: string, importId: string) => `/prodotti/${slug}/importa/${importId}/scarti`,
  exportCsv: (slug: string, query: string) =>
    `/prodotti/${slug}/esporta${query ? `?${query}` : ""}`,
};
