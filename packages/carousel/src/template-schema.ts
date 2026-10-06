import { z } from "zod";
import { channels, FORMATS, formatIdSchema, safeZoneSchema } from "./formats";

/** Slide roles of the agency catalog (spec: "Ruoli delle slide"). */
export const slideRoles = [
  "cover",
  "text",
  "list",
  "quote",
  "data",
  "problem_solution",
  "comparison",
  "cta",
] as const;
export type SlideRole = (typeof slideRoles)[number];

export const slideRoleLabels: Record<SlideRole, string> = {
  cover: "Copertina",
  text: "Testo",
  list: "Elenco",
  quote: "Citazione",
  data: "Dato",
  problem_solution: "Problema-soluzione",
  comparison: "Confronto",
  cta: "CTA",
};

/** Semantic Brand Identity color roles a template variable can bind to. */
export const colorRoles = [
  "background",
  "surface",
  "text.primary",
  "text.secondary",
  "accent",
  "cta.bg",
  "cta.text",
] as const;
export type ColorRole = (typeof colorRoles)[number];

export const fontRoles = ["heading", "body"] as const;
export type FontRole = (typeof fontRoles)[number];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const hexColorSchema = z.string().regex(HEX, "Colore esadecimale (#RRGGBB)");

/** CSS custom property the template uses, e.g. `--fc-bg`. */
const cssVarName = z.string().regex(/^--fc-[a-z0-9-]{1,40}$/, "Variabile CSS --fc-...");
const SLOT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const relPath = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i, "Percorso relativo nel pacchetto")
  .refine((p) => !p.split("/").includes(".."), "Percorso relativo nel pacchetto");

const textSlotSchema = z.object({
  name: z.string().regex(SLOT_NAME),
  type: z.literal("text"),
  label: z.string().max(60).optional(),
  maxChars: z.number().int().min(1).max(1000),
  maxLines: z.number().int().min(1).max(30).optional(),
  required: z.boolean().default(false),
  /** Lets the copy mark a highlighted span with `==parola==` (rendered as text, never markup). */
  highlight: z.boolean().default(false),
});

const listSlotSchema = z.object({
  name: z.string().regex(SLOT_NAME),
  type: z.literal("list"),
  label: z.string().max(60).optional(),
  /** Per item. */
  maxChars: z.number().int().min(1).max(500),
  minItems: z.number().int().min(0).max(12).default(0),
  maxItems: z.number().int().min(1).max(12),
  required: z.boolean().default(false),
  highlight: z.boolean().default(false),
});

const imageSlotSchema = z.object({
  name: z.string().regex(SLOT_NAME),
  type: z.literal("image"),
  label: z.string().max(60).optional(),
  minWidth: z.number().int().min(1).max(8000).optional(),
  minHeight: z.number().int().min(1).max(8000).optional(),
  required: z.boolean().default(false),
});

export const slotSchema = z.discriminatedUnion("type", [
  textSlotSchema,
  listSlotSchema,
  imageSlotSchema,
]);
export type SlotDef = z.infer<typeof slotSchema>;
export type TextSlotDef = z.infer<typeof textSlotSchema>;
export type ListSlotDef = z.infer<typeof listSlotSchema>;
export type ImageSlotDef = z.infer<typeof imageSlotSchema>;

/** Example values per slot: images are referenced by a path inside the package (`assets/...`). */
export const sampleValueSchema = z.union([
  z.string().max(2000),
  z.array(z.string().max(500)).max(12),
  z.object({ asset: relPath, alt: z.string().max(300).optional() }),
]);

export const layoutSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  name: z.string().min(1).max(60),
  role: z.enum(slideRoles),
  /** Where the layout may appear in a carousel. */
  position: z.enum(["first", "last", "any"]).default("any"),
  file: relPath,
  safeZone: safeZoneSchema.optional(),
  slots: z.array(slotSchema).max(16),
  sample: z.record(z.string(), sampleValueSchema).default({}),
});
export type LayoutDef = z.infer<typeof layoutSchema>;

export const fontFileSchema = z.object({
  family: z.string().min(1).max(80),
  file: relPath,
  /** Single weight ("400") or variable range ("300 700"). */
  weight: z
    .string()
    .regex(/^\d{3}( \d{3})?$/)
    .default("400"),
  style: z.enum(["normal", "italic"]).default("normal"),
  license: z.string().max(40).optional(),
});

export const compositionRulesSchema = z.object({
  ctaOnlyLast: z.boolean().default(true),
  logoOnCover: z.boolean().default(true),
  pageNumbers: z.boolean().default(true),
  maxImagesPerSlide: z.number().int().min(0).max(4).default(1),
  notes: z.string().max(500).default(""),
});

export const templateManifestSchema = z
  .object({
    $schema: z.string().optional(),
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/, "id: minuscole, cifre e trattini"),
    name: z.string().min(1).max(60),
    description: z.string().max(240).default(""),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Versione semver (es. 1.0.0)"),
    kind: z.enum(["carousel", "report"]).default("carousel"),
    channel: z.enum(channels),
    format: formatIdSchema,
    width: z.number().int(),
    height: z.number().int(),
    slides: z.object({
      min: z.number().int().min(1).max(20),
      max: z.number().int().min(1).max(20),
      default: z.number().int().min(1).max(20),
    }),
    safeZone: safeZoneSchema.optional(),
    styles: z.array(relPath).min(1).max(8),
    fonts: z.array(fontFileSchema).max(12).default([]),
    colorRoles: z.record(
      cssVarName,
      z.object({ role: z.enum(colorRoles), fallback: hexColorSchema }),
    ),
    fontRoles: z
      .record(
        cssVarName,
        z.object({ role: z.enum(fontRoles), fallback: z.string().min(1).max(80) }),
      )
      .default({}),
    /** Allowed `font-size` values in px; empty = no check. */
    typeScale: z.array(z.number().positive()).max(30).default([]),
    layouts: z.array(layoutSchema).min(1).max(24),
    rules: compositionRulesSchema.default({
      ctaOnlyLast: true,
      logoOnCover: true,
      pageNumbers: true,
      maxImagesPerSlide: 1,
      notes: "",
    }),
  })
  .superRefine((t, ctx) => {
    const f = FORMATS[t.format];
    if (f.channel !== t.channel)
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: `Il formato ${f.label} è del canale ${f.channel}`,
      });
    if (t.width !== f.width || t.height !== f.height)
      ctx.addIssue({
        code: "custom",
        path: ["width"],
        message: `${f.label} è ${f.width}×${f.height} px`,
      });
    const { min, max, default: def } = t.slides;
    if (!(min <= def && def <= max))
      ctx.addIssue({
        code: "custom",
        path: ["slides"],
        message: "Numero di slide: deve valere minimo ≤ default ≤ massimo ≤ 20",
      });
    const ids = new Set<string>();
    t.layouts.forEach((l, i) => {
      if (ids.has(l.id))
        ctx.addIssue({ code: "custom", path: ["layouts", i, "id"], message: "Layout duplicato" });
      ids.add(l.id);
      const names = new Set<string>();
      l.slots.forEach((s, j) => {
        if (names.has(s.name))
          ctx.addIssue({
            code: "custom",
            path: ["layouts", i, "slots", j, "name"],
            message: `Slot duplicato "${s.name}"`,
          });
        names.add(s.name);
        if (s.type === "list" && s.minItems > s.maxItems)
          ctx.addIssue({
            code: "custom",
            path: ["layouts", i, "slots", j],
            message: "minItems > maxItems",
          });
      });
    });
    const vars = [...Object.keys(t.colorRoles), ...Object.keys(t.fontRoles)];
    if (new Set(vars).size !== vars.length)
      ctx.addIssue({
        code: "custom",
        path: ["fontRoles"],
        message: "Una variabile non può essere sia colore sia font",
      });
  });

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type TemplateManifestInput = z.input<typeof templateManifestSchema>;

export function effectiveSafeZone(t: TemplateManifest, layout?: LayoutDef) {
  return layout?.safeZone ?? t.safeZone ?? FORMATS[t.format].safeZone;
}

export function findLayout(t: TemplateManifest, id: string): LayoutDef | undefined {
  return t.layouts.find((l) => l.id === id);
}
