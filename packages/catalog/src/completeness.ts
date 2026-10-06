import { isEmptyValue, type ProductDraft } from "./fields";

export type Completeness = "complete" | "partial" | "minimal";

export const completenessLabels: Record<Completeness, string> = {
  complete: "Completo",
  partial: "Parziale",
  minimal: "Minimo",
};

/**
 * Three levels (UXA-P6-03). Commercial data never counts: a product without
 * price is not incomplete.
 */
export function completenessOf(
  fields: ProductDraft,
  imageCount: number,
): { level: Completeness; missing: string[]; segments: 1 | 2 | 3 } {
  const missing: string[] = [];
  if (isEmptyValue(fields.category)) missing.push("categoria");
  if (isEmptyValue(fields.shortDescription)) missing.push("descrizione breve");
  const specs = [fields.materials, fields.formats, fields.usage, fields.features];
  if (specs.every(isEmptyValue)) missing.push("scheda tecnica");
  if (isEmptyValue(fields.usage)) missing.push("istruzioni d'uso");
  if (imageCount === 0) missing.push("foto");
  const core = !isEmptyValue(fields.name) && !isEmptyValue(fields.shortDescription);
  if (!core) return { level: "minimal", missing, segments: 1 };
  if (missing.length === 0) return { level: "complete", missing, segments: 3 };
  return { level: "partial", missing, segments: 2 };
}
