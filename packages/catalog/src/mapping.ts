import { z } from "zod";
import { sanitizeDraft, type FieldKey, type ProductDraft, type ProductVariant } from "./fields";
import type { SourceRef } from "./meta";
import { htmlToText, normalizeKey, splitList } from "./text";

/** Mapping targets offered for each column (page 73, step 2). */
export const mappingTargets = [
  "name",
  "sku",
  "category",
  "shortDescription",
  "longDescription",
  "materials",
  "formats",
  "usage",
  "features",
  "benefits",
  "variants",
  "image",
  "tags",
  "url",
  "notes",
  "price",
  "currency",
  "availability",
  "parent",
  "type",
  "externalId",
] as const;
export type MappingTarget = (typeof mappingTargets)[number] | "ignore";

export const mappingTargetLabels: Record<MappingTarget, string> = {
  name: "Name",
  sku: "SKU/code",
  category: "Category",
  shortDescription: "Short description",
  longDescription: "Long description",
  materials: "Ingredients or materials",
  formats: "Formats",
  usage: "Usage instructions",
  features: "Features",
  benefits: "Benefits",
  variants: "Variants (with separator)",
  image: "Image (file name or URL)",
  tags: "Tags",
  url: "URL",
  notes: "Notes",
  price: "Price (optional)",
  currency: "Currency (optional)",
  availability: "Availability (optional)",
  parent: "Parent product (WooCommerce variations)",
  type: "Type (WooCommerce)",
  externalId: "External ID (to link variants)",
  ignore: "Ignore column",
};

export const columnMappingSchema = z.object({
  /** One target per column index (same order as the headers). */
  columns: z.array(z.enum([...mappingTargets, "ignore"])),
  /** Separator for list and variant columns; default auto (new line, | or ;). */
  listSeparator: z.string().max(3).optional(),
  preset: z.enum(["woocommerce", "saved", "heuristic", "ai", "manual"]).optional(),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

// Header synonyms match Italian and English column names in client files.
const SYNONYMS: Record<Exclude<MappingTarget, "ignore">, string[]> = {
  name: [
    "name",
    "nome",
    "nome prodotto",
    "product name",
    "prodotto",
    "titolo",
    "title",
    "denominazione",
    "articolo",
    "post title",
  ],
  sku: [
    "sku",
    "cod",
    "codice",
    "codice articolo",
    "codice prodotto",
    "code",
    "product code",
    "ref",
    "riferimento",
    "ean",
    "art",
  ],
  category: [
    "categories",
    "categorie",
    "categoria",
    "category",
    "famiglia",
    "linea",
    "reparto",
    "product cat",
    "tax product cat",
  ],
  shortDescription: [
    "short description",
    "breve descrizione",
    "descrizione breve",
    "desc",
    "sommario",
    "abstract",
    "post excerpt",
    "excerpt",
  ],
  longDescription: [
    "description",
    "descrizione",
    "descrizione lunga",
    "long description",
    "dettagli",
    "post content",
    "testo",
  ],
  materials: [
    "ingredienti",
    "ingredients",
    "materiali",
    "materials",
    "materiale",
    "composizione",
    "composition",
    "inci",
  ],
  formats: [
    "formato",
    "formati",
    "format",
    "formats",
    "size",
    "taglia",
    "dimensioni",
    "contenuto",
    "peso",
    "volume",
    "capacita",
  ],
  usage: [
    "modo d uso",
    "istruzioni",
    "istruzioni d uso",
    "modalita d uso",
    "how to use",
    "usage",
    "uso",
    "directions",
    "utilizzo",
  ],
  features: [
    "caratteristiche",
    "features",
    "specifiche",
    "specifications",
    "specs",
    "scheda tecnica",
  ],
  benefits: ["benefici", "benefits", "vantaggi", "plus"],
  variants: ["varianti", "variants", "attributi", "options", "opzioni"],
  image: [
    "images",
    "immagini",
    "immagine",
    "image",
    "foto",
    "photo",
    "picture",
    "image url",
    "url immagine",
  ],
  tags: ["tags", "tag", "etichette", "parole chiave", "keywords"],
  url: ["url", "link", "external url", "url esterno", "permalink", "product url"],
  notes: ["note", "notes", "purchase note", "nota di acquisto", "commenti"],
  price: [
    "regular price",
    "prezzo di listino",
    "prezzo",
    "price",
    "prezzo regolare",
    "listino",
    "prezzo al pubblico",
  ],
  currency: ["currency", "valuta"],
  availability: [
    "in stock",
    "in magazzino",
    "disponibilita",
    "availability",
    "stock status",
    "stato scorte",
    "disponibile",
  ],
  parent: ["parent", "genitore", "padre"],
  type: ["type", "tipo"],
  externalId: ["id"],
};

const WOOCOMMERCE_MARKERS = [
  ["type", "tipo"],
  ["sku", "cod"],
  ["name", "nome"],
  ["published", "pubblicato"],
  ["visibility in catalog", "visibilita nel catalogo"],
  ["regular price", "prezzo di listino"],
  ["categories", "categorie"],
  ["images", "immagini"],
  ["parent", "genitore"],
  ["tax status", "stato delle imposte", "stato imposte"],
  ["in stock", "in magazzino"],
];

/** True when the headers match the standard WooCommerce product CSV export. */
export function isWooCommerceExport(headers: string[]): boolean {
  const set = new Set(headers.map(normalizeKey));
  const hits = WOOCOMMERCE_MARKERS.filter((alts) => alts.some((a) => set.has(a))).length;
  return hits >= 6;
}

const WOO_ATTRIBUTE = /^(attribute|attributo) (\d+) (name|nome|value s|values|valore i|valori)$/;

/**
 * Suggest a target per column: WooCommerce preset when recognized, otherwise synonyms.
 * Each target is used once (first match wins), the rest is "ignore".
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const woo = isWooCommerceExport(headers);
  const used = new Set<MappingTarget>();
  const columns = headers.map((h): MappingTarget => {
    const key = normalizeKey(h);
    if (woo && (key === "sale price" || key === "prezzo in offerta")) return "ignore";
    if (woo && WOO_ATTRIBUTE.test(key)) return "variants";
    for (const target of Object.keys(SYNONYMS) as Array<Exclude<MappingTarget, "ignore">>) {
      if (used.has(target)) continue;
      if (SYNONYMS[target].includes(key)) {
        used.add(target);
        return target;
      }
    }
    return "ignore";
  });
  return { columns, preset: woo ? "woocommerce" : "heuristic" };
}

/** Stable fingerprint of a header row, to reapply a saved mapping. */
export function headerSignature(headers: string[]): string {
  return headers.map(normalizeKey).join("|");
}

export interface MappedRow {
  draft: ProductDraft;
  sources: Partial<Record<FieldKey, SourceRef>>;
  images: string[];
  /** 1-based row number in the file (header = row 1). */
  row: number;
  parent?: string;
  type?: string;
  externalId?: string;
}

export interface RejectedRow {
  row: number;
  reason: string;
}

const listTargets = new Set<MappingTarget>([
  "materials",
  "formats",
  "usage",
  "features",
  "benefits",
]);

/**
 * Apply a confirmed mapping. Values become plain text (WooCommerce HTML is stripped),
 * price only when the file has it. Rows without a name are rejected with the reason.
 */
export function applyMapping(
  sheet: { headers: string[]; rows: string[][] },
  mapping: ColumnMapping,
  source: Omit<SourceRef, "row" | "column">,
): { rows: MappedRow[]; rejected: RejectedRow[] } {
  const woo = mapping.preset === "woocommerce" || isWooCommerceExport(sheet.headers);
  const sep = mapping.listSeparator || undefined;
  const out: MappedRow[] = [];
  const rejected: RejectedRow[] = [];

  sheet.rows.forEach((cells, i) => {
    const rowNumber = i + 2;
    const draft: Record<string, unknown> = {};
    const sources: Partial<Record<FieldKey, SourceRef>> = {};
    const images: string[] = [];
    const variants: ProductVariant[] = [];
    const attrNames: Record<string, string> = {};
    let parent: string | undefined;
    let type: string | undefined;
    let externalId: string | undefined;

    mapping.columns.forEach((target, col) => {
      const raw = cells[col] ?? "";
      const header = sheet.headers[col] ?? `Column ${col + 1}`;
      if (target === "ignore" || raw.trim() === "") return;
      const text = htmlToText(raw);
      const ref: SourceRef = { ...source, row: rowNumber, column: header };
      const set = (key: FieldKey, value: unknown) => {
        if (draft[key] !== undefined) {
          if (typeof draft[key] === "string" && typeof value === "string")
            draft[key] = `${draft[key]}\n${value}`;
          else if (Array.isArray(draft[key]) && Array.isArray(value))
            draft[key] = [...(draft[key] as unknown[]), ...value];
          return;
        }
        draft[key] = value;
        sources[key] = ref;
      };
      switch (target) {
        case "image":
          images.push(
            ...raw
              .split(/\s*[,|\n]\s*/)
              .map((s) => s.trim())
              .filter(Boolean),
          );
          return;
        case "parent":
          parent = raw.trim();
          return;
        case "type":
          type = normalizeKey(raw);
          return;
        case "externalId":
          externalId = raw.trim();
          return;
        case "tags":
          set("tags", splitList(text, sep ?? ","));
          return;
        case "category": {
          // WooCommerce: "Viso > Creme, Offerte" → first category, deepest level.
          const first = woo ? (text.split(/,\s*/)[0] ?? text) : text;
          set("category", first.split(">").pop()!.trim());
          return;
        }
        case "variants": {
          const key = normalizeKey(header);
          const m = key.match(WOO_ATTRIBUTE);
          if (m) {
            const idx = m[2]!;
            if (m[3] === "name" || m[3] === "nome") attrNames[idx] = text;
            else
              for (const v of splitList(text, ","))
                variants.push({ attribute: attrNames[idx] ?? `Attribute ${idx}`, value: v });
            return;
          }
          for (const item of splitList(text, sep)) {
            const [a, ...rest] = item.split(":");
            variants.push(
              rest.length
                ? { attribute: a!.trim(), value: rest.join(":").trim() }
                : { attribute: header, value: item },
            );
          }
          if (!sources.variants) sources.variants = ref;
          return;
        }
        case "availability": {
          const k = normalizeKey(raw);
          // Written into the client's product data, which is in the client's language (Italian).
          const value = ["1", "yes", "si", "true", "instock", "in stock"].includes(k)
            ? "Disponibile"
            : ["0", "no", "false", "outofstock", "out of stock"].includes(k)
              ? "Non disponibile"
              : text;
          set("availability", value);
          return;
        }
        default:
          if (listTargets.has(target)) set(target as FieldKey, splitList(text, sep));
          else set(target as FieldKey, text);
      }
    });
    if (variants.length) {
      draft.variants = variants;
      sources.variants ??= { ...source, row: rowNumber };
    }
    // Attribute names come before values in WooCommerce exports; fix values seen first.
    for (const v of variants)
      if (v.attribute.startsWith("Attribute ")) {
        const idx = v.attribute.slice(10);
        if (attrNames[idx]) v.attribute = attrNames[idx]!;
      }

    const clean = sanitizeDraft(draft as ProductDraft);
    // A sheet with one short "Descrizione" (description) column: the same text also serves as the short
    // description (copied from the file, never written by us), so the product can be approved.
    if (!clean.shortDescription && clean.longDescription && clean.longDescription.length <= 280) {
      clean.shortDescription = clean.longDescription;
      if (sources.longDescription) sources.shortDescription ??= sources.longDescription;
    }
    const extra = {
      ...(parent ? { parent } : {}),
      ...(type ? { type } : {}),
      ...(externalId ? { externalId } : {}),
    };
    if (type === "variation") {
      // Folded into the parent's variants by groupWooVariations.
      out.push({ draft: clean, sources, images, row: rowNumber, ...extra });
      return;
    }
    if (!clean.name) {
      rejected.push({ row: rowNumber, reason: `Row ${rowNumber}: missing name` });
      return;
    }
    out.push({ draft: clean, sources, images, row: rowNumber, ...extra });
  });
  return groupWooVariations(out, rejected);
}

/**
 * WooCommerce exports variations as separate rows pointing to the parent ("id:123" or
 * the parent SKU). They become variants of the parent product, with their own SKU.
 */
function groupWooVariations(
  rows: MappedRow[],
  rejected: RejectedRow[],
): { rows: MappedRow[]; rejected: RejectedRow[] } {
  const variations = rows.filter((r) => r.type === "variation");
  if (variations.length === 0) return { rows, rejected };
  const parents = rows.filter((r) => r.type !== "variation");
  const bySku = new Map(parents.filter((p) => p.draft.sku).map((p) => [p.draft.sku!, p]));
  const byId = new Map(parents.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  for (const v of variations) {
    const ref = v.parent ?? "";
    const parent =
      (ref.startsWith("id:") ? byId.get(ref.slice(3)) : bySku.get(ref)) ??
      byId.get(ref) ??
      parents.find((p) => p.draft.name && p.draft.name === v.draft.name?.split(" - ")[0]);
    if (!parent) {
      if (v.draft.name) parents.push({ ...v, type: "simple" });
      else
        rejected.push({ row: v.row, reason: `Row ${v.row}: variation without a parent product` });
      continue;
    }
    const attrs = v.draft.variants?.length
      ? v.draft.variants
      : [{ attribute: "Variant", value: v.draft.name ?? v.draft.sku ?? "" }];
    const merged = [
      ...(parent.draft.variants ?? []).filter(
        (x) => x.sku || !attrs.some((a) => a.attribute === x.attribute),
      ),
      ...attrs.map((a) => ({ ...a, ...(v.draft.sku ? { sku: v.draft.sku } : {}) })),
    ];
    parent.draft.variants = merged.slice(0, 100);
    parent.images.push(...v.images);
  }
  return { rows: parents, rejected };
}
