/** URLs of the content module (English route names, like the rest of the app). */
export const contentPath = (slug: string) => `/content/${slug}`;
export const planPath = (slug: string) => `/content/${slug}/plan`;
export const carouselsPath = (slug: string) => `/content/${slug}/carousels`;
export const libraryPath = (slug: string) => `/content/${slug}/library`;
export const carouselPath = (slug: string, id: string) => `/content/${slug}/carousels/${id}`;

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(d),
  );
}

export function formatCost(microUsd: number): string {
  return `${(microUsd / 1_000_000).toLocaleString("en-GB", { style: "currency", currency: "USD", maximumFractionDigits: 3 })}`;
}
