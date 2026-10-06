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
  strategy: "Strategia",
  verbal: "Verbale",
  visual: "Visual",
  content: "Contenuti",
  presence: "Presenza e competitor",
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
  .refine((t) => t.$value !== undefined, "Il token deve avere $value");

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
  f("/document/strategy/positioning", "strategy", "Posizionamento", "sourced", true, str()),
  f("/document/strategy/promise", "strategy", "Promessa", "sourced", true, str(600)),
  f("/document/strategy/differentiation", "strategy", "Differenziazione", "sourced", true, str()),
  f(
    "/document/strategy/perceivedPositioning",
    "presence",
    "Posizionamento percepito",
    "sourced",
    false,
    str(),
  ),
  f("/document/strategy/mission", "strategy", "Missione", "sourced", true, str(1000)),
  f("/document/strategy/vision", "strategy", "Visione", "sourced", false, str(1000)),
  f("/document/strategy/category", "strategy", "Categoria", "sourced", false, str(200)),
  f("/document/strategy/values", "strategy", "Valori", "sourced-list", true, valueItemSchema, (v) =>
    lower(byKey("name")(v)),
  ),
  f(
    "/document/strategy/audience",
    "strategy",
    "Pubblico",
    "sourced-list",
    true,
    audienceSegmentSchema,
    (v) => lower(byKey("name")(v)),
  ),
  f(
    "/document/strategy/messages",
    "strategy",
    "Messaggi e claim",
    "sourced-list",
    true,
    messageSchema,
  ),
  f(
    "/document/strategy/avoidTopics",
    "strategy",
    "Temi da evitare",
    "sourced-list",
    false,
    str(300),
    lower,
  ),
  f("/document/verbal/voice", "verbal", "Voce", "sourced", true, str(1000)),
  f(
    "/document/verbal/toneAxes",
    "verbal",
    "Assi del tono",
    "sourced-list",
    true,
    toneAxisSchema,
    byKey("axis"),
  ),
  f(
    "/document/verbal/weAreWeAreNot",
    "verbal",
    "Siamo / Non siamo",
    "sourced-list",
    true,
    weAreSchema,
    (v) => lower(byKey("weAre")(v)),
  ),
  f(
    "/document/verbal/writingRules",
    "verbal",
    "Regole di scrittura",
    "sourced",
    false,
    writingRulesSchema,
  ),
  f(
    "/document/verbal/preferredWords",
    "verbal",
    "Parole preferite",
    "string-list",
    false,
    str(80),
    lower,
  ),
  f(
    "/document/verbal/forbiddenWords",
    "verbal",
    "Parole vietate",
    "string-list",
    false,
    str(80),
    lower,
  ),
  f(
    "/document/visual/logo/variants",
    "visual",
    "Varianti del logo",
    "object-list",
    false,
    logoVariantSchema,
    byKey("role"),
  ),
  f(
    "/document/visual/logo/forbiddenUses",
    "visual",
    "Usi vietati del logo",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f(
    "/document/visual/typography",
    "visual",
    "Tipografia",
    "sourced-list",
    false,
    typographySchema,
    (v) => lower(byKey("family")(v)),
  ),
  f("/document/visual/imagery", "visual", "Sistema fotografico", "sourced", false, imagerySchema),
  f("/document/visual/do", "visual", "Da fare", "string-list", false, str(300), lower),
  f("/document/visual/dont", "visual", "Da non fare", "string-list", false, str(300), lower),
  f(
    "/document/content/pillars",
    "content",
    "Pilastri",
    "sourced-list",
    false,
    pillarSchema,
    byKey("key"),
  ),
  f(
    "/document/channels",
    "content",
    "Regole per canale",
    "sourced-list",
    false,
    channelRulesSchema,
    byKey("channel"),
  ),
  f("/document/presence", "presence", "Presenza digitale", "sourced-list", false, presenceSchema),
  f(
    "/document/competitors/list",
    "presence",
    "Competitor",
    "sourced-list",
    false,
    competitorSchema,
    (v) => lower(byKey("name")(v)),
  ),
  f(
    "/document/competitors/overusedMessages",
    "presence",
    "Messaggi abusati nel settore",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f(
    "/document/competitors/commonVisualCodes",
    "presence",
    "Codici visivi comuni",
    "string-list",
    false,
    str(300),
    lower,
  ),
  f("/tokens/color/reference", "visual", "Palette", "token-group", true, dtcgToken),
  f("/tokens/color/semantic", "visual", "Ruoli dei colori", "token-group", true, dtcgToken),
  f("/tokens/font/family", "visual", "Famiglie dei font", "token-group", false, dtcgToken),
  f("/tokens/component", "visual", "Token di componente", "token-group", false, dtcgToken),
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
