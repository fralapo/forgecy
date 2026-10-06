/**
 * BrandIdentityDocument: the content of a Brand Identity version (spec tab
 * "Brand Identity", "Data model"). Every interpretive field is `Sourced`: its
 * value plus the sources it cites and a confidence computed by the server.
 * Word lists are plain strings, approved as a block with the version.
 */
import { confidenceLevels } from "@forgecy/core";
import { z } from "zod";

const text = (max = 2000) => z.string().trim().min(1).max(max);
const optText = (max = 2000) => z.string().trim().max(max).optional();
const list = <T extends z.ZodType>(item: T, max = 200) => z.array(item).max(max).prefault([]);

export function sourced<T extends z.ZodType>(value: T) {
  return z.object({
    id: z.string().min(1).max(40),
    value,
    sourceIds: z.array(z.string().max(64)).max(50).prefault([]),
    confidence: z.enum(confidenceLevels).prefault("high"),
    deprecated: z.boolean().optional(),
    acceptedFromProposalId: z.string().max(64).optional(),
  });
}

export interface Sourced<T> {
  id: string;
  value: T;
  sourceIds: string[];
  confidence: (typeof confidenceLevels)[number];
  deprecated?: boolean | undefined;
  acceptedFromProposalId?: string | undefined;
}

// ---- Strategy ----

export const valueItemSchema = z.object({ name: text(120), description: optText(600) });

export const awarenessLevels = [
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
] as const;

export const audienceSegmentSchema = z.object({
  name: text(120),
  role: optText(200),
  sector: optText(200),
  awareness: z.enum(awarenessLevels).optional(),
  goals: optText(),
  problems: optText(),
  fears: optText(),
  objections: optText(),
  triggers: optText(),
  language: optText(),
  channels: optText(400),
  alternatives: optText(),
});

export const messageKinds = [
  "value_proposition",
  "tagline",
  "claim",
  "proof_point",
  "reason_to_believe",
  "elevator_pitch",
  "objection",
  "cta",
] as const;

export const messageSchema = z.object({
  kind: z.enum(messageKinds),
  text: text(1000),
  /** The proof or the source of a claim; claims without proof are flagged before publication. */
  proof: optText(1000),
  /** Answer, for objections. */
  answer: optText(1000),
});

export const strategySchema = z.object({
  oneLiner: sourced(text(300)).optional(),
  insight: sourced(text(600)).optional(),
  positioning: sourced(text(2000)).optional(),
  promise: sourced(text(600)).optional(),
  differentiation: sourced(text(2000)).optional(),
  /** From the Audit: how the market sees the brand today. Not a production rule. */
  perceivedPositioning: sourced(text(2000)).optional(),
  mission: sourced(text(1000)).optional(),
  vision: sourced(text(1000)).optional(),
  category: sourced(text(200)).optional(),
  values: list(sourced(valueItemSchema), 30),
  audience: list(sourced(audienceSegmentSchema), 20),
  messages: list(sourced(messageSchema), 100),
  /** Topics to avoid become binding rules of the brand check. */
  avoidTopics: list(sourced(text(300)), 50),
});

// ---- Verbal identity ----

export const toneAxes = [
  { key: "formal", left: "Formal", right: "Informal" },
  { key: "technical", left: "Technical", right: "Simple" },
  { key: "serious", left: "Serious", right: "Ironic" },
  { key: "institutional", left: "Institutional", right: "Human" },
  { key: "conservative", left: "Conservative", right: "Bold" },
] as const;
export type ToneAxisKey = (typeof toneAxes)[number]["key"];
const toneAxisKeys = toneAxes.map((a) => a.key) as [ToneAxisKey, ...ToneAxisKey[]];

/** An adjective without examples does not pass: both sentences are required. */
export const toneAxisSchema = z.object({
  axis: z.enum(toneAxisKeys),
  value: z.number().int().min(1).max(5),
  goodExample: text(400),
  badExample: text(400),
});

export const weAreSchema = z.object({ weAre: text(200), weAreNot: text(200) });

export const writingRulesSchema = z.object({
  person: z.enum(["tu", "lei", "voi", "noi", "impersonale"]).optional(),
  emoji: z.enum(["no", "limited", "yes"]).optional(),
  maxSentenceWords: z.number().int().min(3).max(80).optional(),
  maxHashtags: z.number().int().min(0).max(30).optional(),
  anglicisms: z.enum(["avoid", "limited", "allowed"]).optional(),
  exclamations: z.enum(["no", "limited", "yes"]).optional(),
  capitalization: optText(400),
  numbers: optText(400),
  ctaStyle: optText(400),
  headlineStyle: optText(400),
  captionStyle: optText(400),
  notes: optText(2000),
});

export const verbalSchema = z.object({
  voice: sourced(text(1000)).optional(),
  toneAxes: list(sourced(toneAxisSchema), 5),
  weAreWeAreNot: list(sourced(weAreSchema), 30),
  writingRules: sourced(writingRulesSchema).optional(),
  preferredWords: list(text(80), 300),
  forbiddenWords: list(text(80), 300),
  /** Terms with their correct spelling (product names, trademarks). */
  spellings: list(z.object({ term: text(120), note: optText(300) }), 200),
});

// ---- Visual identity ----

export const logoRoles = [
  "logo_primary",
  "logo_secondary",
  "symbol",
  "wordmark",
  "logo_mono",
  "logo_negative",
  "favicon",
] as const;

export const logoVariantSchema = z.object({
  id: z.string().min(1).max(40),
  role: z.enum(logoRoles),
  /** brand_sources row holding the file. */
  sourceId: z.string().max(64).optional(),
  background: z.enum(["light", "dark", "any"]).prefault("any"),
  note: optText(300),
});

export const logoRulesSchema = z.object({
  variants: list(logoVariantSchema, 30),
  clearSpace: optText(300),
  minSizePx: z.number().int().min(4).max(2000).optional(),
  allowedBackgrounds: optText(400),
  forbiddenUses: list(text(300), 50),
});

export const typographyRoles = ["display", "body", "data"] as const;

export const typographySchema = z.object({
  role: z.enum(typographyRoles),
  family: text(120),
  weights: z.array(z.number().int().min(100).max(1000)).max(12).prefault([]),
  fallback: optText(200),
  license: optText(300),
  licenseStatus: z.enum(["verified", "to_verify"]).prefault("to_verify"),
  /** brand_sources row holding the font file, when imported. */
  sourceId: z.string().max(64).optional(),
});

export const imagerySchema = z.object({
  subjects: list(text(200), 50),
  settings: list(text(200), 50),
  framing: list(text(200), 50),
  lighting: list(text(200), 50),
  colorMood: list(text(200), 50),
  people: optText(400),
  illustration: optText(1000),
  forbidden: list(text(200), 50),
});

export const layoutRulesSchema = z.object({
  grid: optText(400),
  margins: optText(400),
  maxElements: z.number().int().min(1).max(30).optional(),
  logoPosition: optText(200),
  ctaPosition: optText(200),
  textDensity: optText(400),
  notes: optText(2000),
});

export const visualSchema = z.object({
  logo: logoRulesSchema.prefault({}),
  typography: list(sourced(typographySchema), 12),
  imagery: sourced(imagerySchema).optional(),
  layout: layoutRulesSchema.prefault({}),
  do: list(text(300), 50),
  dont: list(text(300), 50),
});

// ---- Content and channels ----

export const funnelStages = ["awareness", "consideration", "conversion", "loyalty"] as const;

export const pillarSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,40}$/)
    .max(41),
  name: text(120),
  goal: text(600),
  audienceId: z.string().max(40).optional(),
  funnel: z.enum(funnelStages).optional(),
  themes: list(text(200), 30),
  /** A specific emotion ("relief"), not "positive". */
  emotion: optText(120),
  frequency: optText(120),
  cta: optText(300),
  forbidden: list(text(300), 30),
});

export const formatSchema = z.object({
  id: z.string().min(1).max(40),
  key: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,40}$/)
    .max(41),
  name: text(120),
  goal: optText(600),
  /** Step sequence (hook, problem, insight...) with the catalog layout for each step. */
  steps: list(z.object({ step: text(120), layout: optText(120) }), 20),
  maxWordsPerSlide: z.number().int().min(1).max(200).optional(),
  cta: optText(300),
});

export const channelKeys = ["instagram", "linkedin", "facebook", "tiktok"] as const;

export const channelRulesSchema = z.object({
  channel: z.enum(channelKeys),
  goal: optText(600),
  /** How the tone moves from the constant voice on this channel. */
  toneShift: optText(600),
  formats: optText(400),
  frequency: optText(120),
  hashtags: list(text(80), 30),
  cta: optText(300),
  notes: optText(1000),
});

export const contentSchema = z.object({
  pillars: list(sourced(pillarSchema), 12),
  formats: list(formatSchema, 30),
});

// ---- Presence and competitors (filled by the Audit) ----

export const presenceAreas = [
  "website",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "other",
] as const;

export const presenceSchema = z.object({ area: z.enum(presenceAreas), observation: text(2000) });

export const competitorSchema = z.object({
  name: text(200),
  kind: z.enum(["direct", "indirect", "alternative"]).prefault("direct"),
  url: optText(400),
  notes: optText(2000),
});

export const competitorsSchema = z.object({
  list: list(sourced(competitorSchema), 30),
  overusedMessages: list(text(300), 50),
  commonVisualCodes: list(text(300), 50),
  openSpaces: list(text(300), 50),
});

export const brandIdentityDocumentSchema = z.object({
  schemaVersion: z.literal(1).prefault(1),
  strategy: strategySchema.prefault({}),
  verbal: verbalSchema.prefault({}),
  visual: visualSchema.prefault({}),
  content: contentSchema.prefault({}),
  channels: list(sourced(channelRulesSchema), 8),
  presence: list(sourced(presenceSchema), 50),
  competitors: competitorsSchema.prefault({}),
});

export type BrandIdentityDocument = z.output<typeof brandIdentityDocumentSchema>;
export type StrategySection = BrandIdentityDocument["strategy"];
export type VerbalSection = BrandIdentityDocument["verbal"];
export type VisualSection = BrandIdentityDocument["visual"];
export type ContentSection = BrandIdentityDocument["content"];

/** Editable top-level sections, each saved as a whole by the block pages. */
export const documentSections = {
  strategy: strategySchema,
  verbal: verbalSchema,
  visual: visualSchema,
  content: contentSchema,
  channels: list(sourced(channelRulesSchema), 8),
  presence: list(sourced(presenceSchema), 50),
  competitors: competitorsSchema,
} as const;
export type DocumentSectionKey = keyof typeof documentSections;

export function emptyDocument(): BrandIdentityDocument {
  return brandIdentityDocumentSchema.parse({});
}

/** Parse a stored document (older or partial ones get their defaults). */
export function parseDocument(value: unknown): BrandIdentityDocument {
  return brandIdentityDocumentSchema.parse(value ?? {});
}

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The positioning must fit one line: under 20 words (creative-director one-liner test). */
export const ONE_LINER_MAX_WORDS = 20;
