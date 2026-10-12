import type { FieldDef, ProductVariant } from "@forgecy/catalog/fields";

/** Field value → editable text: lists one item per line, variants "attribute | value | SKU". */
export function toText(def: FieldDef, v: unknown): string {
  if (def.kind === "variants")
    return ((v ?? []) as ProductVariant[])
      .map((x) => [x.attribute, x.value, x.sku ?? ""].join(" | ").replace(/ \| $/, ""))
      .join("\n");
  if (Array.isArray(v)) return v.join("\n");
  return String(v ?? "");
}

/** Editable text → field value (the server validates it again). */
export function fromText(def: FieldDef, text: string): unknown {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (def.kind === "variants")
    return lines.map((l) => {
      const [attribute = "", value = "", sku] = l.split("|").map((s) => s.trim());
      return sku ? { attribute, value, sku } : { attribute, value };
    });
  if (def.kind === "list" || def.kind === "tags") return lines;
  return text.trim();
}
