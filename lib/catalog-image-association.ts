import { z } from "zod";
import { normalizeCatalogName, type CatalogProduct } from "./catalog-import";
import type { DocumentImage } from "./document-image";

export type ImageAssociation = { product_name: string; image_index: number | null };
export const nativeImageAssociationSchema=z.object({associations:z.array(z.object({
  product_name:z.string().trim().min(2).max(180),image_index:z.number().int().min(0).max(7).nullable(),
})).max(200)}).strict();

/** Return exact image-to-product links only when one native PDF image names one unique product. */
export function inferUniqueNativeImageAssociations(products:CatalogProduct[],images:DocumentImage[]):ImageAssociation[]{
 const namesByKey=new Map(products.map(product=>[normalizeCatalogName(product.name),product.name]));
 const appearances=new Map<string,number>();
 for(const image of images){
  if(image.origin!=="native-pdf")continue;
  for(const key of new Set((image.candidateProductNames||[]).map(normalizeCatalogName)))
   appearances.set(key,(appearances.get(key)||0)+1);
 }
 return images.flatMap((image,image_index)=>{
  if(image.origin!=="native-pdf"||image.candidateProductNames?.length!==1)return [];
  const key=normalizeCatalogName(image.candidateProductNames[0]!);
  const name=namesByKey.get(key);
  return name&&appearances.get(key)===1?[{product_name:name,image_index}]:[];
 });
}

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
