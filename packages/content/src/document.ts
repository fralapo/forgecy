/**
 * Shapes of the Content Strategy items, the brief, the outline and the carousel
 * document. Browser-safe: the web app validates forms with the same schemas the
 * server and the worker use.
 */
import { FORMATS, slideRoles, slideSchema, type FormatId, type Slide } from "@forgecy/carousel";
import {
  confidenceLevels,
  contentObjectives,
  frequencyUnits,
  funnelStages,
  messageRefSchema,
} from "@forgecy/core";
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([]);

/**
 * Social formats a content can use. The MVP ones are always offered; the v1 ones
 * (Instagram 1:1, Stories, Facebook, TikTok) are offered once a published template
 * declares them (see `offeredFormats`).
 */
export const releasedFormats = Object.values(FORMATS)
  .filter((f) => f.kind === "carousel")
  .map((f) => f.id);
export const releasedFormatSchema = z.enum(releasedFormats as [FormatId, ...FormatId[]]);

export const contentChannels = ["instagram", "linkedin", "facebook", "tiktok"] as const;
export type ContentChannel = (typeof contentChannels)[number];
export const contentChannelSchema = z.enum(contentChannels);

/** Caption limits per channel (UXA-P4-04). */
export const captionLimits: Record<ContentChannel, number> = {
  instagram: 2200,
  linkedin: 3000,
  facebook: 63206,
  tiktok: 4000,
};

/** Caption tiers a brief can ask for, and their character budgets (always within the channel's limit). */
export const captionLengths = ["short", "standard", "long"] as const;
export type CaptionLength = (typeof captionLengths)[number];
const captionTierChars: Record<CaptionLength, number> = { short: 300, standard: 900, long: 2000 };
export const captionBudget = (channel: ContentChannel, tier: CaptionLength) =>
  Math.min(captionLimits[channel], captionTierChars[tier]);

/** Default format of each channel, used when the Planner proposes a plan item. */
export const channelFormat: Record<ContentChannel, FormatId> = {
  instagram: "ig_4x5",
  linkedin: "linkedin_doc",
  facebook: "fb_4x5",
  tiktok: "tiktok_photo",
};

/** Formats to offer: the MVP ones, plus every format a published template declares. */
export function offeredFormats(publishedTemplateFormats: Iterable<string>): FormatId[] {
  const declared = new Set(publishedTemplateFormats);
  return releasedFormats.filter((id) => FORMATS[id].phase === "mvp" || declared.has(id));
}

export const contentLanguages = [
  { code: "en", label: "English" },
  { code: "it", label: "Italian" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
] as const;
export const languageSchema = z.enum(["it", "en", "de", "fr", "es"]);

export const objectiveSchema = z.enum(contentObjectives);
export const funnelSchema = z.enum(funnelStages);

export const frequencySchema = z.object({
  count: z.number().int().min(1).max(60),
  unit: z.enum(frequencyUnits),
});
export type Frequency = z.infer<typeof frequencySchema>;

/** Contents per week, to compare rubrics with their pillar (UXA-P3-16). */
export function perWeek(f: Frequency | null | undefined): number {
  if (!f) return 0;
  return f.unit === "week" ? f.count : (f.count * 12) / 52;
}

// ---- Provenance of a proposal ----

export const proposalSourceSchema = z.object({
  kind: z.enum(["brand", "audit", "strategy", "catalog", "brief"]),
  /** English text; `ref` shows it in the reader's language. */
  label: z.string().max(200),
  ref: messageRefSchema.optional(),
});

export const provenanceSchema = z.object({
  agent: z.enum(["planner", "copywriter", "art_director"]),
  jobId: z.string().max(64).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(120).optional(),
  rationale: z.string().max(1000).default(""),
  sources: list(proposalSourceSchema, 10),
  /** Computed from the sources by the server, never reported by the model. */
  confidence: z.enum(confidenceLevels).default("medium"),
  instruction: z.string().max(500).optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

// ---- Strategy items ----

export const pillarExampleSchema = z.object({ title: required(80), text: text(400) });

export const pillarInputSchema = z.object({
  name: required(40),
  goal: text(160).default(""),
  audienceIds: list(z.string().max(40), 20),
  funnel: funnelSchema.nullable().default(null),
  themes: list(required(80), 10),
  frequency: frequencySchema.nullable().default(null),
  cta: text(200).default(""),
  emotion: text(60).default(""),
  examples: list(pillarExampleSchema, 10),
  forbidden: list(required(200), 30),
  productIds: list(z.uuid(), 20),
});
export type PillarInput = z.output<typeof pillarInputSchema>;
export type PillarInputRaw = z.input<typeof pillarInputSchema>;

export const rubricStepSchema = z.object({ name: required(40), role: z.enum(slideRoles) });

export const rubricInputSchema = z.object({
  pillarId: z.uuid(),
  name: required(40),
  frequency: frequencySchema.nullable().default(null),
  structure: list(rubricStepSchema, 20),
  hookFormula: text(200).default(""),
  hookExample: text(200).default(""),
  cta: text(200).default(""),
  templateKey: z.string().max(64).nullable().default(null),
  channels: list(contentChannelSchema, contentChannels.length),
  ownerId: z.uuid().nullable().default(null),
  productIds: list(z.uuid(), 20),
});
export type RubricInput = z.output<typeof rubricInputSchema>;
export type RubricInputRaw = z.input<typeof rubricInputSchema>;

export const planItemInputSchema = z.object({
  day: z.number().int().min(1).max(30),
  channel: contentChannelSchema,
  format: releasedFormatSchema,
  pillarId: z.uuid(),
  rubricId: z.uuid().nullable().default(null),
  theme: required(120),
  hook: text(120).default(""),
  notes: text(1000).default(""),
  productIds: list(z.uuid(), 20),
});
export type PlanItemInput = z.output<typeof planItemInputSchema>;
export type PlanItemInputRaw = z.input<typeof planItemInputSchema>;

// ---- Carousel parameters and brief ----

export const carouselParamsSchema = z.object({
  title: text(160).default(""),
  objective: objectiveSchema,
  audienceIds: z.array(z.string().max(40)).min(1).max(20),
  pillarId: z.uuid().nullable().default(null),
  rubricId: z.uuid().nullable().default(null),
  productId: z.uuid().nullable().default(null),
  channel: contentChannelSchema,
  format: releasedFormatSchema,
  templateKey: z.string().min(1).max(64),
  slideCount: z.number().int().min(1).max(20),
  language: languageSchema.default("en"),
  planItemId: z.uuid().nullable().default(null),
});
export type CarouselParams = z.output<typeof carouselParamsSchema>;
export type CarouselParamsInput = z.input<typeof carouselParamsSchema>;

/** Spec: the free text needs at least 20 characters before the outline can start. */
export const BRIEF_MIN_CHARS = 20;

export const toneShiftSchema = z.object({
  axis: z.string().max(40),
  /** Move of at most one step from the Brand Identity value (UXA-P3-38). */
  delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});

export const briefSchema = z.object({
  text: text(2000).default(""),
  problem: text(300).default(""),
  audienceNote: text(300).default(""),
  promise: text(200).default(""),
  toneShift: list(toneShiftSchema, 10),
  constraints: list(required(200), 20),
  cta: text(200).default(""),
  /** Offered only when the product has a price (UXA-P3-47); off by default. */
  usePrice: z.boolean().default(false),
  outputs: z
    .object({
      caption: z.boolean().default(true),
      /** Caption tier; briefs saved before tiers existed read as "standard". */
      captionLength: z.enum(captionLengths).default("standard"),
      hashtags: z.number().int().min(0).max(10).default(5),
      altText: z.boolean().default(true),
      designerNotes: z.boolean().default(false),
    })
    .prefault({}),
  /** Fields still holding the value copied from the plan item (“From the plan”). */
  fromPlan: list(z.enum(["text", "problem", "promise", "cta", "constraints"]), 5),
});
export type Brief = z.output<typeof briefSchema>;
export type BriefInput = z.input<typeof briefSchema>;

// ---- Outline ----

export const outlineRowSchema = z.object({
  id: z.string().min(1).max(40),
  role: z.enum(slideRoles),
  point: text(280),
  layout: z.string().min(1).max(40),
  note: text(300).default(""),
  /** Changed by a person: “Keep the rows edited by hand” keeps it on regeneration. */
  edited: z.boolean().default(false),
});
export type OutlineRow = z.output<typeof outlineRowSchema>;

export const outlineSchema = z.object({
  title: text(160).default(""),
  hook: text(200).default(""),
  /** Up to two other hooks the Copywriter proposed; a person may swap one in. */
  hookAlternatives: list(required(200), 2),
  rows: z.array(outlineRowSchema).min(1).max(20),
  cta: text(200).default(""),
  caption: text(3000).default(""),
  hashtags: list(z.string().trim().min(1).max(100), 30),
});
export type Outline = z.output<typeof outlineSchema>;
export type OutlineInput = z.input<typeof outlineSchema>;

// ---- Carousel document (draft and versions) ----

export const contentSlideSchema = slideSchema.extend({
  id: z.string().min(1).max(64),
  role: z.enum(slideRoles).optional(),
  /** “Protect from AI”: slot names an AI instruction never changes. */
  protectedSlots: list(z.string().max(32), 16),
  note: text(300).optional(),
});
export type ContentSlide = z.output<typeof contentSlideSchema>;

export const carouselDocumentSchema = z.object({
  title: text(160).default(""),
  slides: z.array(contentSlideSchema).max(20).default([]),
  caption: text(3000).default(""),
  hashtags: list(z.string().trim().min(1).max(100), 30),
});
export type CarouselDocument = z.output<typeof carouselDocumentSchema>;
export type CarouselDocumentInput = z.input<typeof carouselDocumentSchema>;

// ---- Claim critic findings (advisory, stored in the result of the critique job) ----

export const claimKinds = ["figure", "superlative", "health_legal", "time_bound"] as const;
export const claimRisks = ["low", "medium", "high"] as const;

export const claimFindingSchema = z.object({
  /** Slide id, or null for the caption. */
  slideId: z.string().max(64).nullable(),
  kind: z.enum(claimKinds),
  risk: z.enum(claimRisks),
  /** Exact words of the copy the finding is about; the finding is dropped once they are gone. */
  quote: z.string().min(1).max(300),
  reason: z.string().max(300),
});
export type ClaimFinding = z.output<typeof claimFindingSchema>;

/** The renderer only knows plain slides: editor metadata stays out of the HTML. */
export function toRenderSlide(s: ContentSlide): Slide {
  return slideSchema.parse({ id: s.id, layout: s.layout, tone: s.tone, slots: s.slots });
}

export function parseDocument(raw: unknown): CarouselDocument {
  const r = carouselDocumentSchema.safeParse(raw ?? {});
  return r.success ? r.data : carouselDocumentSchema.parse({});
}

export function normalizeHashtag(tag: string): string {
  const t = tag.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return t ? `#${t}` : "";
}

/** Short random id for slides and outline rows (stable across saves). */
export function newSlideId(): string {
  return `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Bases on which a person confirms the right to use an uploaded image commercially. */
export const assetRightsBases = ["own", "client_supplied", "licensed", "public_domain"] as const;
export type AssetRightsBasis = (typeof assetRightsBases)[number];
