import { normalizeCatalogName, type CatalogProduct } from "./catalog-import";
import type { DocumentImage } from "./document-image";

export type ImageAssociation = { product_name: string; image_index: number | null };

/** Apply only exact, page-supported, one-image-per-product visual matches. */
export function applyNativeImageAssociations(
  products: CatalogProduct[],
  images: DocumentImage[],
  associations: ImageAssociation[],
): CatalogProduct[] {
  const candidates = products.filter(product => images.some(image =>
    image.origin === "native-pdf" && image.candidateProductNames?.some(name =>
      normalizeCatalogName(name) === normalizeCatalogName(product.name))));
  const byName = new Map(candidates.map(product => [normalizeCatalogName(product.name), product.name]));
  const usedImages = new Set<number>();
  const assignments = new Map<string, number>();

  for (const association of associations) {
    const name = normalizeCatalogName(association.product_name);
    const canonicalName = byName.get(name);
    const index = association.image_index;
    if (!canonicalName || index === null || !Number.isInteger(index) || index < 0 || index >= images.length || usedImages.has(index)) continue;
    const image = images[index];
    if (!image?.candidateProductNames?.some(candidate => normalizeCatalogName(candidate) === name)) continue;
    usedImages.add(index);
    assignments.set(name, index);
  }

  return products.map(product => ({
    ...product,
    imageIndex: assignments.get(normalizeCatalogName(product.name)) ?? product.imageIndex,
  }));
}
