/** URLs of the content module (Italian route names, like the rest of the app). */
export const contentPath = (slug: string) => `/contenuti/${slug}`;
export const planPath = (slug: string) => `/contenuti/${slug}/piano`;
export const carouselsPath = (slug: string) => `/contenuti/${slug}/caroselli`;
export const libraryPath = (slug: string) => `/contenuti/${slug}/libreria`;
export const carouselPath = (slug: string, id: string) => `/contenuti/${slug}/caroselli/${id}`;

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(d),
  );
}

export function formatCost(microUsd: number): string {
  return `${(microUsd / 1_000_000).toLocaleString("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 3 })}`;
}
