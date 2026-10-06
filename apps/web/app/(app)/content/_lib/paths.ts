/** URLs of the content module (English route names, like the rest of the app). */
export const contentPath = (slug: string) => `/content/${slug}`;
export const planPath = (slug: string) => `/content/${slug}/plan`;
export const carouselsPath = (slug: string) => `/content/${slug}/carousels`;
export const libraryPath = (slug: string) => `/content/${slug}/library`;
export const carouselPath = (slug: string, id: string) => `/content/${slug}/carousels/${id}`;
