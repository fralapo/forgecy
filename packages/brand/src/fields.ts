/**
 * The fields a proposal can target, with their label, block and sensitivity.
 * Sensitive categories (spec: positioning, promise, tone, values, audience,
 * claims, differentiation, official palette) are accepted one by one, never in
 * bulk, and need a note when the computed confidence is low.
 */
import { z } from "zod";
import {
  audienceSegmentSchema,
  channelRulesSchema,
  competitorSchema,
  imagerySchema,
  logoVariantSchema,
  messageSchema,
  pillarSchema,
  presenceSchema,
  toneAxisSchema,
  typographySchema,
  valueItemSchema,
  weAreSchema,
  writingRulesSchema,
} from "./document";

export const blocks = {
  strategy: "Strategy",
  verbal: "Verbal",
  visual: "Visual",
  content: "Content",
  presence: "Presence and competitors",
} as const;
export type BlockKey = keyof typeof blocks;

export type FieldShape =
  /** One Sourced value. */
  | "sourced"
  /** Array of Sourced items. */
  | "sourced-list"
  /** Array of plain strings. */
  | "string-list"
  /** Array of plain objects with an `id`. */
  | "object-list"
  /** A DTCG group: each child is a token. */
  | "token-group";

export interface FieldDef {
  pointer: string;
  block: BlockKey;
  label: string;
  shape: FieldShape;
  sensitive: boolean;
  /** Schema of the raw value (for lists: of one item). */
  value: z.ZodType;
  /** For lists: items sharing this key replace each other instead of piling up. */
  uniqueBy?: (value: unknown) => string | undefined;
}

const str = (max = 2000) => z.string().trim().min(1).max(max);
const byKey = (k: string) => (v: unknown) =>
  typeof v === "object" && v !== null ? String((v as Record<string, unknown>)[k] ?? "") : undefined;
const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : undefined);

const dtcgToken = z
  .object({
    $value: z.unknown(),
    $type: z.string().optional(),
    $description: z.string().max(400).optional(),
    $extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((t) => t.$value !== undefined, "The token must have $value");

const f = (
  pointer: string,
  block: BlockKey,
  label: string,
  shape: FieldShape,
  sensitive: boolean,
  value: z.ZodType,
  uniqueBy?: FieldDef["uniqueBy"],
): FieldDef => ({
  pointer,
  block,
  label,
  shape,
  sensitive,
  value,
  ...(uniqueBy ? { uniqueBy } : {}),
});

export const fields: readonly FieldDef[] = [
  f("/document/strategy/oneLiner", "strategy", "One-liner", "sourced", true, str(300)),
  f("/document/strategy/insight", "strategy", "Insight", "sourced", false, str(600)),
  f("/document/strategy/positioning", "strategy", "Positioning", "sourced", true, str()),
  f("/document/strategy/promise", "strategy", "Promise", "sourced", true, str(600)),
  f("/document/strategy/differentiation", "strategy", "Differentiation", "sourced", true, str()),
  f(
    "/document/strategy/perceivedPositioning",
    "presence",
    "Perceived positioning",
    "sourced",
    false,
    str(),
  ),
  f("/document/strategy/mission", "strategy", "Mission", "sourced", true, str(1000)),
  f("/document/strategy/vision", "strategy", "Vision", "sourced", false, str(1000)),
  f("/document/strategy/category", "strategy", "Category", "sourced", false, str(200)),
  f("/document/strategy/values", "strategy", "Values", "sourced-list", true, valueItemSchema, (v) =>
    lower(byKey("name")(v)),
  ),
  f(
    "/document/strategy/audience",
    "strategy",
    "Audience",
    "sourced-list",
    true,
    audienceSegmentSchema,
    (v) => lower(byKey("name")(v)),
  ),
  f(
    "/document/strategy/messages",
    "strategy",
    "Messages and claims",
    "sourced-list",
    true,
    messageSchema,
  ),
  f(
    "/document/strategy/avoidTopics",
    "strategy",
    "Topics to avoid",
    "sourced-list",
    false,
    str(300),
    lower,
  ),
  f("/document/verbal/voice", "verbal", "Voice", "sourced", true, str(1000)),
  f(
    "/document/verbal/toneAxes",
    "verbal",
    "Tone axes",
    "sourced-list",
    true,
    toneAxisSchema,
    byKey("axis"),
  ),
  f(
    "/document/verbal/weAreWeAreNot",
    "verbal",
    "We are / We are not",
    "sourced-list",
    true,
    weAreSchema,
    (v) => lower(byKey("weAre")(v)),
  ),
  f(
    "/document/verbal/writingRules",
    "verbal",
    "Writing rules",
    "sourced",
    false,
    writingRulesSchema,
  ),
  f(
    "/document/verbal/preferredWords",
    "verbal",
    "Preferred words",
    "string-list",
    false,
    str(80),
    lower,
  ),
  f(
    "/document/verbal/forbiddenWords",
    "verbal",
    "Forbidden words",
    "string-list",
    false,
    str(80),
    lower,
  ),
  f(
    "/document/visual/logo/variants",
    "visual",
    "Logo variants",
    "object-list",
    false,
    logoVariantSchema,
    byKey("role"),
  ),
  f(
    "/document/visual/logo/forbiddenUses",
    "visual",
    "Forbidden logo uses",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f(
    "/document/visual/typography",
    "visual",
    "Typography",
    "sourced-list",
    false,
    typographySchema,
    (v) => lower(byKey("family")(v)),
  ),
  f("/document/visual/imagery", "visual", "Photography system", "sourced", false, imagerySchema),
  f("/document/visual/do", "visual", "Do", "string-list", false, str(300), lower),
  f("/document/visual/dont", "visual", "Don't", "string-list", false, str(300), lower),
  f(
    "/document/content/pillars",
    "content",
    "Pillars",
    "sourced-list",
    false,
    pillarSchema,
    byKey("key"),
  ),
  f(
    "/document/channels",
    "content",
    "Channel rules",
    "sourced-list",
    false,
    channelRulesSchema,
    byKey("channel"),
  ),
  f("/document/presence", "presence", "Digital presence", "sourced-list", false, presenceSchema),
  f(
    "/document/competitors/list",
    "presence",
    "Competitors",
    "sourced-list",
    false,
    competitorSchema,
    (v) => lower(byKey("name")(v)),
  ),
  f(
    "/document/competitors/overusedMessages",
    "presence",
    "Overused messages in the industry",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f(
    "/document/competitors/commonVisualCodes",
    "presence",
    "Common visual codes",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f("/tokens/color/reference", "visual", "Palette", "token-group", true, dtcgToken),
  f("/tokens/color/semantic", "visual", "Color roles", "token-group", true, dtcgToken),
  f("/tokens/font/family", "visual", "Font families", "token-group", false, dtcgToken),
  f("/tokens/component", "visual", "Component tokens", "token-group", false, dtcgToken),
];

export interface FieldMatch {
  field: FieldDef;
  /** Rest of the pointer after the field ("" for the field itself, "/3", "/-", "/primary"). */
  rest: string;
}

/** Finds the field a pointer belongs to (longest prefix). */
export function matchField(pointer: string): FieldMatch | null {
  let best: FieldDef | undefined;
  for (const field of fields)
    if (
      (pointer === field.pointer || pointer.startsWith(`${field.pointer}/`)) &&
      (!best || field.pointer.length > best.pointer.length)
    )
      best = field;
  return best ? { field: best, rest: pointer.slice(best.pointer.length) } : null;
}

export function fieldLabel(pointer: string): string {
  const m = matchField(pointer);
  if (!m) return pointer;
  const tail =
    m.field.shape === "token-group" && m.rest ? ` › ${m.rest.slice(1).replace(/\//g, ".")}` : "";
  return `${blocks[m.field.block]} › ${m.field.label}${tail}`;
}

export function isSensitivePath(pointer: string): boolean {
  return matchField(pointer)?.field.sensitive ?? false;
}

/** Category stored on the proposal: block and field path, e.g. "strategy:strategy.oneLiner". */
export function categoryOf(pointer: string): string {
  const m = matchField(pointer);
  if (!m) return "other";
  const last = m.field.pointer.split("/").filter(Boolean).slice(1).join(".");
  return `${m.field.block}:${last}`;
}
