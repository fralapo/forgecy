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
  /** The ground the pillar owns in the audience's mind. */
  territory: text(160).default(""),
  /** How the pillar is judged (e.g. "saves per post"). */
  metric: text(160).default(""),
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
  /** What one piece of this format costs (free text) and the metric that says it works. */
  cost: text(160).default(""),
  metric: text(160).default(""),
  productIds: list(z.uuid(), 20),
});
export type RubricInput = z.output<typeof rubricInputSchema>;
export type RubricInputRaw = z.input<typeof rubricInputSchema>;

/** Strategy notes of the plan in use: the bottleneck, what the client needs and why this many contents. */
export const planNotesSchema = z.object({
  criticalNode: text(300).default(""),
  clientNeeds: list(required(200), 12),
  countRationale: text(600).default(""),
});
export type PlanNotes = z.output<typeof planNotesSchema>;
export type PlanNotesRaw = z.input<typeof planNotesSchema>;

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

/** Feeling the whole content is built around; one per content. */
export const briefEmotions = [
  "frustration",
  "empathy",
  "relief",
  "fear_of_missing_out",
  "curiosity",
  "pride",
] as const;
/** The one action the content asks the reader for. */
export const briefActions = ["save", "send", "comment", "link", "none"] as const;
export const briefClosings = ["cta", "conclusion"] as const;
/** Kind of content, which drives the slide count hint. */
export const briefObjectives = ["alert", "explainer", "tool", "document"] as const;
/** Slide count range suggested for each kind of content. */
export const slideCountPresets: Record<(typeof briefObjectives)[number], [number, number]> = {
  alert: [3, 5],
  explainer: [6, 8],
  tool: [8, 10],
  document: [8, 12],
};
/** Ways a cover hook can work; labelled on each hook the Copywriter proposes. */
export const hookArchetypes = [
  "dry_statement",
  "habitual_gesture",
  "bare_number",
  "spoken_sentence",
  "common_belief",
  "nobody_explains",
] as const;
export type HookArchetype = (typeof hookArchetypes)[number];
export const hookArchetypeSchema = z.enum(hookArchetypes);

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
  /** The one sentence the reader should leave with. */
  thesis: text(300).default(""),
  emotion: z.enum(briefEmotions).nullable().default(null),
  action: z.enum(briefActions).nullable().default(null),
  /** What makes the reader care today. */
  trigger: text(200).default(""),
  closing: z.enum(briefClosings).nullable().default(null),
  /** Statements the content may make, with where they come from. */
  canSay: list(z.object({ text: required(300), source: text(200).default("") }), 20),
  /** Phrases the content must not contain (checked on the slides and the caption). */
  cannotSay: list(z.object({ text: required(200), reason: text(200).default("") }), 30),
  risk: text(300).default(""),
  /** Points to confirm with the client; the export stays blocked while one is open. */
  openQuestions: list(z.object({ text: required(300), resolved: z.boolean().default(false) }), 20),
  /** First comment to post under the content (links and extras kept out of the caption). */
  firstComment: text(500).default(""),
  hookArchetype: hookArchetypeSchema.nullable().default(null),
  hookRationale: text(300).default(""),
  objective: z.enum(briefObjectives).nullable().default(null),
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

/** Older outlines stored plain strings; they read as a hook with no archetype. */
export type HookAlternative = { text: string; archetype?: HookArchetype };
export const hookAlternativeSchema = z.union([
  required(200).transform((t): HookAlternative => ({ text: t })),
  z.object({ text: required(200), archetype: hookArchetypeSchema.optional() }),
]);

export const outlineSchema = z.object({
  title: text(160).default(""),
  hook: text(200).default(""),
  /** Up to two other hooks the Copywriter proposed; a person may swap one in. */
  hookAlternatives: list(hookAlternativeSchema, 2),
  hookArchetype: hookArchetypeSchema.optional(),
  /** Set by the Copywriter instead of inventing a payoff; the person supplies it in the brief. */
  needsInput: z.literal("payoff").optional(),
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

// ---- Visual reviewer notes (advisory, stored in the result of the review job) ----

export const visualNoteSchema = z.object({
  /** 1-based position of the slide when the review ran. */
  slide: z.number().int().min(1).max(20),
  slideId: z.string().max(64),
  problem: z.string().min(1).max(300),
  /** One atomic fix. */
  fix: z.string().max(300),
});
export type VisualNote = z.output<typeof visualNoteSchema>;

// ---- Channel adaptation proposals (stored in the result of the adapt job) ----

/** Channels an Instagram carousel can be adapted to. */
export const adaptChannels = ["linkedin", "facebook"] as const;
export type AdaptChannel = (typeof adaptChannels)[number];
export const adaptChannelSchema = z.enum(adaptChannels);

/** What decides whether each channel works; shown with the proposal, never scored. */
export const gateMetrics = ["saves_shares", "group_shares_comments", "dwell_comments"] as const;
export type GateMetric = (typeof gateMetrics)[number];
export const gateMetricOf: Record<ContentChannel, GateMetric | null> = {
  instagram: "saves_shares",
  facebook: "group_shares_comments",
  linkedin: "dwell_comments",
  tiktok: null,
};

/** The person's answer to a proposal; absent while it waits. */
export const adaptDecisionSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  contentId: z.uuid().nullable(),
  by: z.uuid().nullable(),
  at: z.string(),
});
export type AdaptDecision = z.output<typeof adaptDecisionSchema>;

export const adaptProposalSchema = z.object({
  sourceContentId: z.uuid(),
  channel: adaptChannelSchema,
  /** False when the channel has no credible equivalent angle: then there are no slides. */
  creditableAngle: z.boolean(),
  /** The angle rewritten for this channel's audience. */
  angle: z.string().max(600),
  reason: z.string().max(500),
  templateKey: z.string().max(64),
  slides: z
    .array(
      z.object({
        layout: z.string().max(40),
        slots: z.record(z.string(), z.union([z.string().max(2000), z.array(z.string().max(500))])),
      }),
    )
    .max(20),
  caption: z.string().max(3000),
  hashtags: z.array(z.string().max(100)).max(15),
  gateMetric: z.enum(gateMetrics),
  /** Draft revision of the source the proposal was made on. */
  draftRev: z.number().int().nullable(),
});
export type AdaptProposal = z.output<typeof adaptProposalSchema>;

/** The renderer only knows plain slides: editor metadata stays out of the HTML. */
export function toRenderSlide(s: ContentSlide): Slide {
  return slideSchema.parse({ id: s.id, layout: s.layout, tone: s.tone, slots: s.slots });
}

/** A draft whose title is empty (a hand-made carousel) shows the content title. */
export function parseDraft(raw: unknown, contentTitle: string): CarouselDocument {
  const doc = parseDocument(raw);
  return doc.title ? doc : { ...doc, title: contentTitle };
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
