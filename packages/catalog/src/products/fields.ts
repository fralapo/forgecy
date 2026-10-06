import { z } from "zod";

/**
 * Product fields (spec page 72). Identity, descriptions, "Specifications",
 * benefits, variants, optional commercial data and internal notes.
 * Price, currency and availability are optional: present only when the client's
 * files contain them, never invented, and approved together with the product.
 */
export const LIMITS = {
  name: 200,
  sku: 80,
  category: 120,
  tag: 60,
  tags: 30,
  url: 2000,
  shortDescription: 280,
  longDescription: 4000,
  listItem: 500,
  listItems: 50,
  variants: 100,
  notes: 4000,
} as const;

const str = (max: number) => z.string().trim().max(max);
const list = z.array(str(LIMITS.listItem)).max(LIMITS.listItems);

export const variantSchema = z.object({
  attribute: str(80),
  value: str(200),
  sku: str(LIMITS.sku).optional(),
});
export type ProductVariant = z.infer<typeof variantSchema>;

export const productFieldsSchema = z.object({
  name: str(LIMITS.name),
  sku: str(LIMITS.sku),
  category: str(LIMITS.category),
  tags: z.array(str(LIMITS.tag)).max(LIMITS.tags),
  url: str(LIMITS.url),
  shortDescription: str(LIMITS.shortDescription),
  longDescription: str(LIMITS.longDescription),
  materials: list,
  formats: list,
  usage: list,
  features: list,
  benefits: list,
  variants: z.array(variantSchema).max(LIMITS.variants),
  price: z
    .string()
    .trim()
    .max(40)
    // Messages are keys of @forgecy/i18n, shown translated by the interface.
    .regex(/^$|^\d+([.,]\d{1,4})?$/, "products.validation.invalidPrice"),
  currency: z
    .string()
    .trim()
    .max(3)
    .regex(/^$|^[A-Z]{3}$/, "products.validation.invalidCurrency"),
  availability: str(120),
  notes: str(LIMITS.notes),
});
export type ProductFields = z.infer<typeof productFieldsSchema>;
export type FieldKey = keyof ProductFields;

/** A partial set of values, as extracted from one source. */
export type ProductDraft = Partial<ProductFields>;

export const fieldKeys = Object.keys(productFieldsSchema.shape) as FieldKey[];

export type FieldKind = "text" | "longtext" | "list" | "tags" | "variants";

export interface FieldDef {
  key: FieldKey;
  label: string;
  kind: FieldKind;
  section: "identity" | "descriptions" | "specs" | "benefits" | "variants" | "commercial" | "notes";
  /** Can carry claims (health, environmental, certifications, warranties). */
  claimable: boolean;
  placeholder?: string;
}

export const fieldDefs: readonly FieldDef[] = [
  { key: "name", label: "Name", kind: "text", section: "identity", claimable: false },
  { key: "sku", label: "SKU/code", kind: "text", section: "identity", claimable: false },
  { key: "category", label: "Category", kind: "text", section: "identity", claimable: false },
  { key: "tags", label: "Tags", kind: "tags", section: "identity", claimable: false },
  { key: "url", label: "URL", kind: "text", section: "identity", claimable: false },
  {
    key: "shortDescription",
    label: "Short description",
    kind: "longtext",
    section: "descriptions",
    claimable: true,
    placeholder: "Add a short description: the Copywriter will use it",
  },
  {
    key: "longDescription",
    label: "Long description",
    kind: "longtext",
    section: "descriptions",
    claimable: true,
  },
  {
    key: "materials",
    label: "Ingredients or materials",
    kind: "list",
    section: "specs",
    claimable: true,
  },
  { key: "formats", label: "Formats", kind: "list", section: "specs", claimable: false },
  { key: "usage", label: "Usage instructions", kind: "list", section: "specs", claimable: true },
  { key: "features", label: "Features", kind: "list", section: "specs", claimable: true },
  { key: "benefits", label: "Benefits", kind: "list", section: "benefits", claimable: true },
  { key: "variants", label: "Variants", kind: "variants", section: "variants", claimable: false },
  { key: "price", label: "Price", kind: "text", section: "commercial", claimable: false },
  { key: "currency", label: "Currency", kind: "text", section: "commercial", claimable: false },
  {
    key: "availability",
    label: "Availability",
    kind: "text",
    section: "commercial",
    claimable: false,
  },
  { key: "notes", label: "Internal notes", kind: "longtext", section: "notes", claimable: false },
];

export const fieldDef = (key: FieldKey): FieldDef => fieldDefs.find((f) => f.key === key)!;

export const sectionLabels: Record<FieldDef["section"], string> = {
  identity: "Identity",
  descriptions: "Descriptions",
  specs: "Specifications",
  benefits: "Benefits",
  variants: "Variants",
  commercial: "Optional commercial data",
  notes: "Internal notes",
};

export function emptyFields(): ProductFields {
  return {
    name: "",
    sku: "",
    category: "",
    tags: [],
    url: "",
    shortDescription: "",
    longDescription: "",
    materials: [],
    formats: [],
    usage: [],
    features: [],
    benefits: [],
    variants: [],
    price: "",
    currency: "",
    availability: "",
    notes: "",
  };
}

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Keys of the draft that carry a value. */
export function filledKeys(draft: ProductDraft): FieldKey[] {
  return fieldKeys.filter((k) => !isEmptyValue(draft[k]));
}

/** Readable value for diffs, CSV and prompts. */
export function formatValue(key: FieldKey, v: unknown): string {
  if (isEmptyValue(v)) return "";
  if (key === "variants")
    return (v as ProductVariant[])
      .map((x) => `${x.attribute}: ${x.value}${x.sku ? ` (${x.sku})` : ""}`)
      .join("; ");
  if (Array.isArray(v)) return v.join("; ");
  return String(v);
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Clean a draft from any source: clamp lengths, drop invalid values instead of failing
 * the whole product, normalize price ("12,50" → "12.50") and currency.
 */
export function sanitizeDraft(draft: ProductDraft): ProductDraft {
  const out: ProductDraft = {};
  for (const key of fieldKeys) {
    const raw = draft[key];
    if (isEmptyValue(raw)) continue;
    let value: unknown = raw;
    if (key === "price" && typeof raw === "string") {
      const m = raw.replace(/\s/g, "").match(/\d+(?:[.,]\d{3})*(?:[.,]\d{1,4})?/);
      if (!m) continue;
      let num = m[0];
      // "1.234,50" or "1,234.50": the last separator is the decimal one.
      const lastSep = Math.max(num.lastIndexOf(","), num.lastIndexOf("."));
      if (lastSep >= 0 && num.length - lastSep - 1 <= 2) {
        num = num.slice(0, lastSep).replace(/[.,]/g, "") + "." + num.slice(lastSep + 1);
      } else num = num.replace(/[.,]/g, "");
      value = num;
    }
    if (key === "currency" && typeof raw === "string") {
      const c = raw.trim().toUpperCase();
      value = c === "€" ? "EUR" : c === "$" ? "USD" : c === "£" ? "GBP" : c;
    }
    const schema = productFieldsSchema.shape[key];
    if (typeof value === "string") value = value.slice(0, 20_000);
    if (Array.isArray(value) && key !== "variants")
      value = (value as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim() !== "")
        .map((x) => x.trim().slice(0, LIMITS.listItem))
        .slice(0, key === "tags" ? LIMITS.tags : LIMITS.listItems);
    if (key === "tags" && Array.isArray(value))
      value = (value as string[]).map((t) => t.slice(0, LIMITS.tag));
    if (typeof value === "string") {
      const max = (LIMITS as Record<string, number>)[key];
      if (max && value.length > max) value = `${value.slice(0, max - 1)}…`;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}
