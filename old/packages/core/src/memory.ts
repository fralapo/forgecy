import { z } from "zod";

/**
 * Agent memory (spec page 56): facts, preferences and settings the agents reuse for a
 * client. An agent only writes `observed` notes and `candidate` proposals; a person
 * approves, rejects, edits (new version) or archives. Only `approved` memories reach
 * the agents' prompts.
 */
export const memoryStatuses = [
  "observed",
  "candidate",
  "approved",
  "rejected",
  "archived",
] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

export const memoryCategories = [
  "preference",
  "style",
  "fact",
  "example",
  "positioning",
  "tone",
  "values",
  "audience",
  "claims",
  "palette",
  "brand_rules",
] as const;
export type MemoryCategory = (typeof memoryCategories)[number];

/** Categories that touch the Brand Identity: decided one by one, never in bulk or inline. */
export const SENSITIVE_MEMORY_CATEGORIES: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
  "positioning",
  "tone",
  "values",
  "audience",
  "claims",
  "palette",
  "brand_rules",
]);

export function isSensitiveMemoryCategory(category: MemoryCategory): boolean {
  return SENSITIVE_MEMORY_CATEGORIES.has(category);
}

export const memoryConfidences = ["high", "medium", "low"] as const;
export type MemoryConfidence = (typeof memoryConfidences)[number];

export const MEMORY_CONTENT_MAX = 500;
/** Approved memories added to one prompt, newest first. */
export const MEMORY_PROMPT_LIMIT = 30;

export const memoryContentSchema = z.string().trim().min(3).max(MEMORY_CONTENT_MAX);

/** Structured settings of a client: typed values, not sentences. */
export const memorySettingKeys = ["slide_count", "format", "language", "default_cta"] as const;
export type MemorySettingKey = (typeof memorySettingKeys)[number];

export const ctaKinds = ["consultation", "download", "contact", "visit"] as const;
export type CtaKind = (typeof ctaKinds)[number];

export const SLIDE_COUNT_MIN = 3;
export const SLIDE_COUNT_MAX = 20;
export const DEFAULT_CTA_MAX = 60;

export const memorySettingSchemas = {
  slide_count: z.number().int().min(SLIDE_COUNT_MIN).max(SLIDE_COUNT_MAX),
  /** A released format id (checked against the formats list by the caller). */
  format: z.string().min(1).max(40),
  /** A deliverable language code (checked against the content languages by the caller). */
  language: z.string().min(2).max(10),
  default_cta: z.object({
    text: z.string().trim().min(1).max(DEFAULT_CTA_MAX),
    kind: z.enum(ctaKinds),
  }),
} as const;

export type MemorySettingValues = {
  [K in MemorySettingKey]: z.infer<(typeof memorySettingSchemas)[K]>;
};
