import type { MessageRef } from "@forgecy/core";
import { englishMessage, type MessageKey, type MessageValues, messageRef } from "@forgecy/i18n";
import { z } from "zod";
import { channels, FORMATS, formatIdSchema, safeZoneSchema } from "./formats";

/**
 * Slide roles of the agency catalog (spec: "Slide roles"). The last five are the
 * pages of a report (audit): section opener, finding, problem, next steps, method.
 */
export const slideRoles = [
  "cover",
  "text",
  "list",
  "quote",
  "data",
  "problem_solution",
  "comparison",
  "cta",
  "section",
  "finding",
  "problem",
  "next_steps",
  "method",
  "contents",
  "palette",
  "typography",
  "logo",
  "signature",
] as const;
export type SlideRole = (typeof slideRoles)[number];

/** Roles of a social carousel: the report pages (section, finding, problem...) left out. */
export const socialSlideRoles = [
  "cover",
  "text",
  "list",
  "quote",
  "data",
  "problem_solution",
  "comparison",
  "cta",
] as const satisfies readonly SlideRole[];

export const slideRoleLabels: Record<SlideRole, string> = {
  cover: "Cover",
  text: "Text",
  list: "List",
  quote: "Quote",
  data: "Data point",
  problem_solution: "Problem-solution",
  comparison: "Comparison",
  cta: "CTA",
  section: "Section",
  finding: "Finding",
  problem: "Problem",
  next_steps: "Next steps",
  method: "Method",
  contents: "Contents",
  palette: "Palette",
  typography: "Typography",
  logo: "Logo",
  signature: "Signature",
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

/** Fixed messages of the manifest schema, recognised by their English text. */
const STATIC_MESSAGES = [
  "templates.manifest.hexColor",
  "templates.manifest.cssVariable",
  "templates.manifest.relativePath",
  "templates.manifest.id",
  "templates.manifest.semver",
  "templates.manifest.duplicateLayout",
  "templates.manifest.minItems",
  "templates.manifest.colorAndFont",
] as const satisfies readonly MessageKey[];
const staticKeys = new Map<string, MessageKey>(STATIC_MESSAGES.map((k) => [englishMessage(k), k]));
const en = (key: (typeof STATIC_MESSAGES)[number]) => englishMessage(key);

/** A custom issue whose English message carries its reference in `params.ref`. */
function issue(
  ctx: z.RefinementCtx,
  path: (string | number)[],
  key: MessageKey,
  values?: MessageValues,
): void {
  ctx.addIssue({
    code: "custom",
    path,
    message: englishMessage(key, values),
    params: { ref: messageRef(key, values) },
  });
}

/** The interface message of a manifest schema issue, when it is one of ours (Zod's own stay English). */
export function manifestIssueRef(i: z.core.$ZodIssue): MessageRef | undefined {
  const ref = (i as { params?: { ref?: MessageRef } }).params?.ref;
  if (ref && typeof ref.key === "string") return ref;
  const key = staticKeys.get(i.message);
  return key ? messageRef(key) : undefined;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const MAX_CAROUSEL_SLIDES = 20;
export const MAX_REPORT_PAGES = 40;

export const hexColorSchema = z.string().regex(HEX, en("templates.manifest.hexColor"));

/** CSS custom property the template uses, e.g. `--fc-bg`. */
const cssVarName = z.string().regex(/^--fc-[a-z0-9-]{1,40}$/, en("templates.manifest.cssVariable"));
const SLOT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const relPath = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i, en("templates.manifest.relativePath"))
  .refine((p) => !p.split("/").includes(".."), en("templates.manifest.relativePath"));

const textSlotSchema = z.object({
  name: z.string().regex(SLOT_NAME),
  type: z.literal("text"),
  label: z.string().max(60).optional(),
  maxChars: z.number().int().min(1).max(1000),
  maxLines: z.number().int().min(1).max(30).optional(),
  required: z.boolean().default(false),
  /** Lets the copy mark a highlighted span with `==word==` (rendered as text, never markup). */
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
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/, en("templates.manifest.id")),
    name: z.string().min(1).max(60),
    description: z.string().max(240).default(""),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, en("templates.manifest.semver")),
    kind: z.enum(["carousel", "report"]).default("carousel"),
    /** Required for social formats, absent for reports. */
    channel: z.enum(channels).optional(),
    format: formatIdSchema,
    width: z.number().int(),
    height: z.number().int(),
    slides: z.object({
      min: z.number().int().min(1).max(MAX_REPORT_PAGES),
      max: z.number().int().min(1).max(MAX_REPORT_PAGES),
      default: z.number().int().min(1).max(MAX_REPORT_PAGES),
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
    // The format's label is a product name ("Instagram 4:5") kept as is in every language.
    const format = f.label;
    if (f.kind !== t.kind)
      issue(ctx, ["kind"], "templates.manifest.formatKind", { format, kind: f.kind });
    if (f.channel && f.channel !== t.channel)
      issue(ctx, ["channel"], "templates.manifest.formatChannel", { format, channel: f.channel });
    if (!f.channel && t.channel)
      issue(ctx, ["channel"], "templates.manifest.formatNoChannel", { format });
    if (t.width !== f.width || t.height !== f.height)
      issue(ctx, ["width"], "templates.manifest.formatSize", {
        format,
        width: String(f.width),
        height: String(f.height),
      });
    const { min, max, default: def } = t.slides;
    const limit = t.kind === "report" ? MAX_REPORT_PAGES : MAX_CAROUSEL_SLIDES;
    if (!(min <= def && def <= max && max <= limit))
      issue(ctx, ["slides"], "templates.manifest.slideCount", {
        kind: t.kind,
        limit: String(limit),
      });
    const ids = new Set<string>();
    t.layouts.forEach((l, i) => {
      if (ids.has(l.id)) issue(ctx, ["layouts", i, "id"], "templates.manifest.duplicateLayout");
      ids.add(l.id);
      const names = new Set<string>();
      l.slots.forEach((s, j) => {
        if (names.has(s.name))
          issue(ctx, ["layouts", i, "slots", j, "name"], "templates.manifest.duplicateSlot", {
            name: s.name,
          });
        names.add(s.name);
        if (s.type === "list" && s.minItems > s.maxItems)
          issue(ctx, ["layouts", i, "slots", j], "templates.manifest.minItems");
      });
    });
    const vars = [...Object.keys(t.colorRoles), ...Object.keys(t.fontRoles)];
    if (new Set(vars).size !== vars.length)
      issue(ctx, ["fontRoles"], "templates.manifest.colorAndFont");
  });

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type TemplateManifestInput = z.input<typeof templateManifestSchema>;

export function effectiveSafeZone(t: TemplateManifest, layout?: LayoutDef) {
  return layout?.safeZone ?? t.safeZone ?? FORMATS[t.format].safeZone;
}

export function findLayout(t: TemplateManifest, id: string): LayoutDef | undefined {
  return t.layouts.find((l) => l.id === id);
}
