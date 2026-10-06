/**
 * Input and output of the Brand Guard. The input is a neutral description of a
 * content (slides, slots, caption) and, when available, the measures of its render:
 * the Contents module builds it from its carousel and the renderer's capture, so this
 * package does not depend on how either stores its data.
 */
import type { BrandCheckOrigin, BrandCheckSeverity } from "@forgecy/core";
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** A color as the slide uses it: a brand token role, or a literal value (templates, imports). */
export const colorUseSchema = z.object({
  /** Token path, e.g. "component.cover.title" or "color.semantic.text-primary". */
  token: z.string().max(200).optional(),
  hex: hex.optional(),
});
export type ColorUse = z.infer<typeof colorUseSchema>;

const textRoles = ["title", "subtitle", "body", "cta", "label", "other"] as const;

const slotBase = {
  name: z.string().min(1).max(80),
  /** Label shown to people ("Titolo"); defaults to the name. */
  label: z.string().max(80).optional(),
  /** Decorative elements may leave the safe zone with a warning instead of an error. */
  decorative: z.boolean().optional(),
};

const typeStyle = {
  /** Font size on the canvas, in px. Needed for "testo grande" and thumbnail legibility. */
  fontSizePx: z.number().positive().optional(),
  bold: z.boolean().optional(),
  color: colorUseSchema.optional(),
  background: colorUseSchema.optional(),
  fontFamily: z.string().max(200).optional(),
};

export const textSlotSchema = z.object({
  ...slotBase,
  ...typeStyle,
  kind: z.literal("text"),
  role: z.enum(textRoles).optional(),
  text: z.string().max(5000),
  maxChars: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().optional(),
});

export const listSlotSchema = z.object({
  ...slotBase,
  ...typeStyle,
  kind: z.literal("list"),
  items: z.array(z.string().max(1000)).max(50),
  maxItems: z.number().int().positive().optional(),
  maxCharsPerItem: z.number().int().positive().optional(),
});

export const imageOrigins = ["ai", "photo", "product", "upload", "logo", "illustration"] as const;

export const imageSlotSchema = z.object({
  ...slotBase,
  kind: z.literal("image"),
  /** Empty slot: no asset chosen. */
  asset: z
    .object({
      id: z.string().max(64),
      origin: z.enum(imageOrigins),
      /** AI images start as draft; only a person approves them. */
      approval: z.enum(["draft", "approved", "rejected"]).optional(),
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
    })
    .optional(),
  /** Size of the slot on the canvas, in px. */
  slotWidth: z.number().positive().optional(),
  slotHeight: z.number().positive().optional(),
});

export const slotSchema = z.discriminatedUnion("kind", [
  textSlotSchema,
  listSlotSchema,
  imageSlotSchema,
]);
export type GuardSlot = z.infer<typeof slotSchema>;
export type GuardTextSlot = z.infer<typeof textSlotSchema>;
export type GuardListSlot = z.infer<typeof listSlotSchema>;
export type GuardImageSlot = z.infer<typeof imageSlotSchema>;

export const slideRoles = ["cover", "content", "cta", "closing"] as const;

export const guardSlideSchema = z.object({
  layout: z.string().max(120),
  role: z.enum(slideRoles).optional(),
  /** Background of the slide, used when a slot does not say its own. */
  background: colorUseSchema.optional(),
  slots: z.array(slotSchema).max(40),
});
export type GuardSlide = z.infer<typeof guardSlideSchema>;

export const guardProductSchema = z.object({
  name: z.string().max(300),
  /** Approved data of the product: description, specs ("Potenza: 24 kW"), materials, certifications. */
  facts: z.array(z.string().max(2000)).max(200),
  price: z.string().max(100).optional(),
});
export type GuardProduct = z.infer<typeof guardProductSchema>;

export const guardContentSchema = z.object({
  channel: z.enum(["instagram", "linkedin", "facebook", "tiktok"]).optional(),
  /** Brand Identity format key (content.formats[].key), for steps and word limits. */
  formatKey: z.string().max(41).optional(),
  /** Canvas size of every slide, in px. */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }),
  slides: z.array(guardSlideSchema).min(1).max(30),
  caption: z.string().max(5000).optional(),
  hashtags: z.array(z.string().max(100)).max(60).optional(),
  limits: z
    .object({
      /** Words per slide recommended by the template; the BI format wins when stricter. */
      maxWordsPerSlide: z.number().int().positive().optional(),
      /** Words of the first slide's title (hook), from the Content Strategy. */
      hookMaxWords: z.number().int().positive().optional(),
    })
    .optional(),
  product: guardProductSchema.optional(),
  brief: z.object({ asksPrice: z.boolean().optional() }).optional(),
});
export type GuardContent = z.infer<typeof guardContentSchema>;

/** Geometry of one filled slot measured on the rendered page (same shape as the renderer's SlotMeasure). */
export const renderSlotSchema = z.object({
  name: z.string(),
  kind: z.enum(["text", "image"]),
  overflow: z.boolean(),
  outsideSlide: z.boolean(),
  outsideSafe: z.boolean(),
  lines: z.number().int().nonnegative(),
  naturalWidth: z.number().nonnegative(),
  naturalHeight: z.number().nonnegative(),
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type RenderSlot = z.infer<typeof renderSlotSchema>;

/** Text and background colors measured on the render pixels of a slot (see ./pixels). */
export const contrastSampleSchema = z.object({
  slot: z.string(),
  fgHex: hex,
  bgHex: hex,
  /** Where the background was measured, for the crosshair in the preview. */
  point: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type ContrastSample = z.infer<typeof contrastSampleSchema>;

export const guardRenderSchema = z.object({
  slides: z
    .array(
      z.object({
        slide: z.number().int().nonnegative(),
        slots: z.array(renderSlotSchema),
        contrast: z.array(contrastSampleSchema).optional(),
      }),
    )
    .max(30),
});
export type GuardRender = z.infer<typeof guardRenderSchema>;

export type CheckCategory = "vocabulary" | "claims" | "editorial" | "visual" | "layout" | "images";

export interface BrandRuleRef {
  /** JSON Pointer into the Brand Identity version, e.g. "/document/verbal/forbiddenWords". */
  path: string;
  text: string;
}

export interface BrandCheckFinding {
  /** Stable across runs: check + slide + slot + what was found. */
  key: string;
  /** Check code, shown in monospace (e.g. `contrast_on_render`). */
  check: string;
  category: CheckCategory;
  severity: BrandCheckSeverity;
  origin: BrandCheckOrigin;
  /** 0-based slide index; null for caption and whole-content findings. */
  slide: number | null;
  slot: string | null;
  message: string;
  measured?: string | number;
  threshold?: string | number;
  suggestion?: string;
  rule?: BrandRuleRef;
  /** Hash of the checked block: an ignored finding reopens when it changes. */
  blockHash: string;
  /** The only finding kind that blocks approval (not sending to review). */
  blocksApproval?: boolean;
}

/** Bands of spec 12.6 (UXA-13): 0–39, 40–59, 60–74, 75–89, 90–100. */
export type ScoreBand = "critico" | "debole" | "discreto" | "buono" | "eccellente";

export interface CoherenceScore {
  score: number;
  band: ScoreBand;
  /** Per category: score and the keys of the findings that lowered it (the evidence). */
  categories: Array<{
    category: CheckCategory;
    score: number;
    band: ScoreBand;
    evidence: string[];
  }>;
}

export interface BrandCheckReport {
  brandIdentityVersionId: string;
  brandIdentityVersionNumber: number;
  checkedAt: string;
  hasRender: boolean;
  findings: BrandCheckFinding[];
  counts: Record<BrandCheckSeverity, number>;
  coherence: CoherenceScore;
  /** Checks that need the model or data the input did not carry; shown as "non attivi". */
  notRun: Array<{ check: string; reason: string }>;
}
