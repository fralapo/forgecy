/**
 * Configuration of a batch automation (page 59): the common carousel parameters and
 * the items, one per carousel. Pure and browser-safe: the form uses the same checks
 * as the server, so "Start" is disabled for the same reasons the server refuses it.
 */
import { AUTOMATION_MAX_ITEMS, automationStopPoints } from "@forgecy/core";
import {
  BRIEF_MIN_CHARS,
  contentChannelSchema,
  languageSchema,
  objectiveSchema,
  releasedFormatSchema,
} from "@forgecy/content/document";
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

/** Parameters every carousel of the automation shares; an item may override some. */
export const automationParamsSchema = z.object({
  channel: contentChannelSchema.default("instagram"),
  format: releasedFormatSchema.default("ig_4x5"),
  /** Null: the template's default number of slides. */
  slideCount: z.number().int().min(1).max(20).nullable().default(null),
  language: languageSchema.default("en"),
  /** Null: “Automatic”, the first published template of the format. */
  templateKey: z.string().min(1).max(64).nullable().default(null),
  /** Brand Identity audiences; empty means every live audience. */
  audienceIds: z.array(z.string().max(40)).max(20).default([]),
});
export type AutomationParams = z.output<typeof automationParamsSchema>;

export const automationItemSchema = z.object({
  /** Stable key of the item inside the automation (run items point to it). */
  id: z.string().min(1).max(40),
  title: text(160).default(""),
  brief: text(2000).default(""),
  objective: objectiveSchema.nullable().default(null),
  pillarId: z.uuid().nullable().default(null),
  rubricId: z.uuid().nullable().default(null),
  audienceNote: text(300).default(""),
  cta: text(200).default(""),
  /** Set for items taken from the client's 30-day plan. */
  planItemId: z.uuid().nullable().default(null),
  /** Per-item overrides of the common parameters. */
  format: releasedFormatSchema.nullable().default(null),
  channel: contentChannelSchema.nullable().default(null),
});
export type AutomationItem = z.output<typeof automationItemSchema>;
export type AutomationItemInput = z.input<typeof automationItemSchema>;

export const automationItemsSchema = z.array(automationItemSchema).max(AUTOMATION_MAX_ITEMS);

export const automationConfigSchema = z.object({
  name: text(120).min(1),
  stopAt: z.enum(automationStopPoints),
  params: automationParamsSchema,
  items: automationItemsSchema,
});
export type AutomationConfig = z.output<typeof automationConfigSchema>;

export type ItemIssue = "briefTooShort" | "noObjective";

/** Why an item cannot run yet (page 59: incomplete rows are marked with the reason). */
export function itemIssues(item: Pick<AutomationItem, "brief" | "objective">): ItemIssue[] {
  const issues: ItemIssue[] = [];
  if (item.brief.trim().length < BRIEF_MIN_CHARS) issues.push("briefTooShort");
  if (!item.objective) issues.push("noObjective");
  return issues;
}

export type StartBlocker = "noItems" | "incompleteItems" | "tooManyItems";

/** Reasons the configuration cannot start, before policy, budget and queue checks. */
export function configBlockers(items: readonly AutomationItem[]): StartBlocker[] {
  const out: StartBlocker[] = [];
  if (items.length === 0) out.push("noItems");
  if (items.length > AUTOMATION_MAX_ITEMS) out.push("tooManyItems");
  if (items.some((i) => itemIssues(i).length > 0)) out.push("incompleteItems");
  return out;
}

/** Format and channel of an item, after its overrides. */
export function itemTarget(item: AutomationItem, params: AutomationParams) {
  return { format: item.format ?? params.format, channel: item.channel ?? params.channel };
}

/** Parses stored JSON leniently: rows written by an older version keep loading. */
export function readParams(raw: unknown): AutomationParams {
  const r = automationParamsSchema.safeParse(raw ?? {});
  return r.success ? r.data : automationParamsSchema.parse({});
}

export function readItems(raw: unknown): AutomationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const r = automationItemSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}
