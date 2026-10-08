/**
 * The rule-based Brand Guard (spec Page 46, MVP checks with default severities
 * UXA-P4-12). Pure and deterministic: the same content, render measures and Brand
 * Identity version always give the same findings in the same order. Checks that need
 * the model's judgement (hook specificity, tone, product facts without numbers) are
 * listed in `notRun` and belong to the Reviewer agent.
 */
import { createHash } from "node:crypto";
import type { BrandIdentityDocument } from "@forgecy/brand/document";
import {
  referenceColors,
  resolveTokens,
  semanticColorRoles,
  tokenColorHex,
  type TokenTree,
} from "@forgecy/brand/tokens";
import type { BrandCheckSeverity } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { checkContrast, colorToHex, formatRatio, WCAG } from "@forgecy/ui/tokens";
import { coherenceScore, RENDER_UNVERIFIED } from "./score";
import type {
  BrandCheckFinding,
  BrandCheckReport,
  CheckCategory,
  ColorUse,
  GuardContent,
  GuardImageSlot,
  GuardRender,
  GuardSlide,
  GuardSlot,
  GuardTextSlot,
  RenderSlot,
} from "./types";

/** The Brand Identity version the content is checked against (a PublishedBrandIdentity fits). */
export interface GuardBrand {
  versionId: string;
  number: number;
  document: BrandIdentityDocument;
  tokens: TokenTree;
}

export interface CheckOptions {
  /** Time stamped on the report; fixed in tests. */
  now?: Date;
  /** Width of the feed thumbnail in CSS px (Instagram profile grid on a 375 px phone). */
  thumbnailWidth?: number;
  /** Minimum title height in the thumbnail, UXA-P4-13. */
  thumbnailMinPx?: number;
  /** Words of the hook when the Content Strategy gives none. */
  defaultHookMaxWords?: number;
  /** Add a warning when no render was measured, so an approver sees the layout checks did not run. */
  flagUnverifiedRender?: boolean;
}

export const DEFAULTS = {
  thumbnailWidth: 123,
  thumbnailMinPx: 8,
  defaultHookMaxWords: 12,
  /** UXA-14: large text is ≥ 68 px, or 54 px bold, on a 1080 px wide canvas. */
  largeTextPx: 68,
  largeBoldTextPx: 54,
  referenceWidth: 1080,
} as const;

const hash = (...parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

/** `==word==` marks a highlight in the renderer; it is not part of the text. */
export const plainText = (s: string) => s.replace(/==/g, "");

export function countWords(s: string): number {
  return plainText(s)
    .split(/\s+/u)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";

/** Whole-word, case-insensitive occurrences of a phrase (spaces match any whitespace). */
export function findPhrase(text: string, phrase: string): string[] {
  const p = phrase.trim();
  if (!p) return [];
  const body = p.split(/\s+/u).map(escapeRe).join("\\s+");
  return [...plainText(text).matchAll(new RegExp(`${B}${body}${E}`, "giu"))].map((m) => m[0]);
}

const slotLabel = (s: { name: string; label?: string | undefined }) => s.label ?? s.name;

/**
 * The finding's text in English (stored, logs, API) plus a message reference the
 * interface shows in the person's language. Numbers that are not plurals go in as
 * text so they read exactly as measured ("1080 px", not "1,080 px").
 */
type FindingKey = Extract<MessageKey, `review.guard.finding.${string}`>;
type SuggestionKey = Extract<MessageKey, `review.guard.suggestion.${string}`>;
const say = (key: FindingKey, values?: MessageValues) => ({
  message: englishMessage(key, values),
  ref: messageRef(key, values),
});
const suggest = (key: SuggestionKey, values?: MessageValues) => ({
  suggestion: englishMessage(key, values),
  suggestionRef: messageRef(key, values),
});
const notRunReason = (
  check: string,
  key: Extract<MessageKey, `review.guard.notRun.${string}`>,
) => ({ check, reason: englishMessage(key), reasonRef: messageRef(key) });
/** Where a text block is: "caption", or the slide number with the slot label. */
const at = (slide: number | null, slot: string) =>
  slide === null ? { slide: "caption", slot: "" } : { slide: String(slide + 1), slot };

function blockText(slot: GuardSlot): string {
  if (slot.kind === "text") return slot.text;
  if (slot.kind === "list") return slot.items.join("\n");
  return "";
}

interface Block {
  slide: number | null;
  slot: string;
  label: string;
  text: string;
  hash: string;
}

function textBlocks(content: GuardContent): Block[] {
  const out: Block[] = [];
  content.slides.forEach((slide, i) => {
    for (const slot of slide.slots) {
      const text = blockText(slot);
      if (text.trim())
        out.push({ slide: i, slot: slot.name, label: slotLabel(slot), text, hash: hash(slot) });
    }
  });
  if (content.caption?.trim())
    out.push({
      slide: null,
      slot: "caption",
      label: "Caption",
      text: content.caption,
      hash: hash(content.caption, content.hashtags),
    });
  return out;
}

type NewFinding = Omit<BrandCheckFinding, "key"> & { discriminator?: string };

class Findings {
  readonly list: BrandCheckFinding[] = [];
  private readonly seen = new Set<string>();

  add(f: NewFinding) {
    const { discriminator, ...rest } = f;
    const key = `${f.check}:${hash(f.check, f.slide, f.slot, discriminator ?? "")}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const finding = { key, ...rest } as BrandCheckFinding;
    for (const k of Object.keys(finding) as Array<keyof BrandCheckFinding>)
      if (finding[k] === undefined) delete finding[k];
    this.list.push(finding);
  }
}

interface Ctx {
  content: GuardContent;
  doc: BrandIdentityDocument;
  render: GuardRender | undefined;
  out: Findings;
  options: Required<Pick<CheckOptions, "thumbnailWidth" | "thumbnailMinPx" | "defaultHookMaxWords">>;
  notRun: BrandCheckReport["notRun"];
}

// ---------------------------------------------------------------- editorial

function checkLengths(ctx: Ctx) {
  ctx.content.slides.forEach((slide, i) => {
    for (const slot of slide.slots) {
      const h = hash(slot);
      if (slot.kind === "text" && slot.maxChars) {
        const n = plainText(slot.text).trim().length;
        if (n > slot.maxChars)
          ctx.out.add({
            check: "text_length",
            category: "editorial",
            severity: "error",
            origin: "json",
            slide: i,
            slot: slot.name,
            ...say("review.guard.finding.textLength", {
              slot: slotLabel(slot),
              count: String(n),
              max: String(slot.maxChars),
            }),
            measured: n,
            threshold: slot.maxChars,
            blockHash: h,
          });
      }
      if (slot.kind !== "list") continue;
      if (slot.maxItems && slot.items.length > slot.maxItems)
        ctx.out.add({
          check: "list_items",
          category: "editorial",
          severity: "error",
          origin: "json",
          slide: i,
          slot: slot.name,
          ...say("review.guard.finding.listItems", {
            slot: slotLabel(slot),
            count: String(slot.items.length),
            max: String(slot.maxItems),
          }),
          measured: slot.items.length,
          threshold: slot.maxItems,
          blockHash: h,
        });
      const max = slot.maxCharsPerItem;
      if (max)
        slot.items.forEach((item, j) => {
          const n = plainText(item).trim().length;
          if (n > max)
            ctx.out.add({
              check: "text_length",
              category: "editorial",
              severity: "error",
              origin: "json",
              slide: i,
              slot: slot.name,
              discriminator: String(j),
              ...say("review.guard.finding.itemLength", {
                slot: slotLabel(slot),
                item: String(j + 1),
                count: String(n),
                max: String(max),
              }),
              measured: n,
              threshold: max,
              blockHash: h,
            });
        });
    }
  });
}

function format(ctx: Ctx) {
  const key = ctx.content.formatKey;
  return key ? ctx.doc.content.formats.find((f) => f.key === key) : undefined;
}

function checkDensity(ctx: Ctx) {
  const fmt = format(ctx);
  const limits = [ctx.content.limits?.maxWordsPerSlide, fmt?.maxWordsPerSlide].filter(
    (n): n is number => typeof n === "number",
  );
  if (!limits.length) return;
  const limit = Math.min(...limits);
  const rule =
    fmt && fmt.maxWordsPerSlide === limit
      ? {
          path: `/document/content/formats/${ctx.doc.content.formats.indexOf(fmt)}/maxWordsPerSlide`,
          text: `Format “${fmt.name}”: at most ${limit} words per slide.`,
        }
      : undefined;
  ctx.content.slides.forEach((slide, i) => {
    const words = slide.slots.reduce((n, s) => n + countWords(blockText(s)), 0);
    if (words > limit * 0.9)
      ctx.out.add({
        check: "word_density",
        category: "editorial",
        severity: "warning",
        origin: "json",
        slide: i,
        slot: null,
        ...say(
          words > limit ? "review.guard.finding.wordsOver" : "review.guard.finding.wordsNear",
          { slide: String(i + 1), count: String(words), max: String(limit) },
        ),
        measured: words,
        threshold: limit,
        ...suggest("review.guard.suggestion.moveText"),
        rule,
        blockHash: hash(slide.slots.map(blockText)),
      });
  });
}

const titleSlot = (slide: GuardSlide): GuardTextSlot | undefined => {
  const texts = slide.slots.filter((s): s is GuardTextSlot => s.kind === "text");
  return texts.find((s) => s.role === "title") ?? texts.find((s) => s.text.trim());
};

function checkHook(ctx: Ctx) {
  const title = titleSlot(ctx.content.slides[0]!);
  if (!title) return;
  const max = ctx.content.limits?.hookMaxWords ?? ctx.options.defaultHookMaxWords;
  const words = countWords(title.text);
  if (words > max)
    ctx.out.add({
      check: "hook_length",
      category: "editorial",
      severity: "warning",
      origin: "json",
      slide: 0,
      slot: title.name,
      ...say("review.guard.finding.hookLength", { count: String(words), max: String(max) }),
      measured: words,
      threshold: max,
      ...suggest("review.guard.suggestion.hookCover"),
      blockHash: hash(title),
    });
}

function checkCta(ctx: Ctx) {
  const slides = ctx.content.slides;
  const i = slides.length - 1;
  const last = slides[i]!;
  const hasCta =
    last.slots.some((s) => s.kind === "text" && s.role === "cta" && s.text.trim()) ||
    (last.role === "cta" && last.slots.some((s) => blockText(s).trim()));
  if (hasCta) return;
  const ctaStyle = ctx.doc.verbal.writingRules?.value.ctaStyle;
  ctx.out.add({
    check: "cta_missing",
    category: "editorial",
    severity: "warning",
    origin: "json",
    slide: i,
    slot: null,
    ...say("review.guard.finding.ctaMissing"),
    ...suggest("review.guard.suggestion.ctaMissing"),
    rule: ctaStyle
      ? { path: "/document/verbal/writingRules/value/ctaStyle", text: ctaStyle }
      : undefined,
    blockHash: hash(last),
  });
}

function checkStructure(ctx: Ctx) {
  const fmt = format(ctx);
  const slides = ctx.content.slides;
  if (fmt && fmt.steps.length > slides.length)
    ctx.out.add({
      check: "structure",
      category: "editorial",
      severity: "note",
      origin: "json",
      slide: null,
      slot: null,
      ...say("review.guard.finding.structureSteps", {
        format: fmt.name,
        steps: String(fmt.steps.length),
        list: fmt.steps.map((s) => s.step).join(", "),
        slides: String(slides.length),
      }),
      measured: slides.length,
      threshold: fmt.steps.length,
      rule: {
        path: `/document/content/formats/${ctx.doc.content.formats.indexOf(fmt)}/steps`,
        text: fmt.steps.map((s) => s.step).join(" → "),
      },
      blockHash: hash(slides.map((s) => s.layout)),
    });
  const first = slides[0]!;
  if (slides.length > 1 && first.role && first.role !== "cover")
    ctx.out.add({
      check: "structure",
      category: "editorial",
      severity: "note",
      origin: "json",
      slide: 0,
      slot: null,
      discriminator: "cover",
      ...say("review.guard.finding.structureCover"),
      blockHash: hash(first.layout, first.role),
    });
}

// ---------------------------------------------------------------- vocabulary

function checkForbiddenWords(ctx: Ctx, blocks: Block[]) {
  const preferred = ctx.doc.verbal.preferredWords;
  for (const b of blocks)
    for (const [wi, word] of ctx.doc.verbal.forbiddenWords.entries()) {
      const hits = findPhrase(b.text, word);
      if (hits.length)
        ctx.out.add({
          check: "forbidden_word",
          category: "vocabulary",
          severity: "error",
          origin: "json",
          slide: b.slide,
          slot: b.slot,
          discriminator: word.toLowerCase(),
          ...say("review.guard.finding.forbiddenWord", {
            ...at(b.slide, b.label),
            word: hits[0]!,
          }),
          measured: hits[0],
          ...(preferred.length
            ? suggest("review.guard.suggestion.preferredWords", {
                words: preferred.slice(0, 8).join(", "),
              })
            : {}),
          rule: { path: `/document/verbal/forbiddenWords/${wi}`, text: word },
          blockHash: b.hash,
        });
    }
}

// Italian locale on purpose: it capitalizes client content, which is mostly Italian.
const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase("it") + s.slice(1);

function checkSpellings(ctx: Ctx, blocks: Block[]) {
  for (const [si, { term }] of ctx.doc.verbal.spellings.entries()) {
    const compact = [...term.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));
    if (compact.length < 2) continue;
    const re = new RegExp(`${B}${compact.map(escapeRe).join("[\\s.\\-]?")}${E}`, "giu");
    for (const b of blocks)
      for (const m of plainText(b.text).matchAll(re)) {
        const found = m[0];
        if (found === term || found === capitalize(term)) continue;
        ctx.out.add({
          check: "spelling",
          category: "vocabulary",
          severity: "warning",
          origin: "json",
          slide: b.slide,
          slot: b.slot,
          discriminator: `${term}|${found}`,
          ...say("review.guard.finding.spelling", { ...at(b.slide, b.label), term, found }),
          measured: found,
          ...suggest("review.guard.suggestion.replaceWith", { term }),
          rule: { path: `/document/verbal/spellings/${si}`, text: term },
          blockHash: b.hash,
        });
      }
  }
}

function checkAvoidTopics(ctx: Ctx, blocks: Block[]) {
  // Only literal mentions are deterministic; the topic as a theme needs the Reviewer agent.
  for (const [ti, topic] of ctx.doc.strategy.avoidTopics.entries()) {
    if (topic.deprecated || topic.value.split(/\s+/u).length > 4) continue;
    for (const b of blocks) {
      const hits = findPhrase(b.text, topic.value);
      if (hits.length)
        ctx.out.add({
          check: "avoid_topic",
          category: "vocabulary",
          severity: "warning",
          origin: "json",
          slide: b.slide,
          slot: b.slot,
          discriminator: topic.value.toLowerCase(),
          ...say("review.guard.finding.avoidTopic", { ...at(b.slide, b.label), found: hits[0]! }),
          measured: hits[0],
          rule: { path: `/document/strategy/avoidTopics/${ti}`, text: topic.value },
          blockHash: b.hash,
        });
    }
  }
}

function checkWritingRules(ctx: Ctx, blocks: Block[]) {
  const wr = ctx.doc.verbal.writingRules?.value;
  if (!wr) return;
  const rulePath = "/document/verbal/writingRules/value";
  for (const b of blocks) {
    const text = plainText(b.text);
    const where = at(b.slide, b.label);
    if (wr.maxSentenceWords) {
      const longest = text
        .split(/[.!?…]+|\n/u)
        .map(countWords)
        .reduce((a, n) => Math.max(a, n), 0);
      if (longest > wr.maxSentenceWords)
        ctx.out.add({
          check: "sentence_length",
          category: "vocabulary",
          severity: "warning",
          origin: "json",
          slide: b.slide,
          slot: b.slot,
          ...say("review.guard.finding.sentenceLength", {
            ...where,
            count: String(longest),
            max: String(wr.maxSentenceWords),
          }),
          measured: longest,
          threshold: wr.maxSentenceWords,
          rule: {
            path: `${rulePath}/maxSentenceWords`,
            text: `Sentences of at most ${wr.maxSentenceWords} words.`,
          },
          blockHash: b.hash,
        });
    }
    const emoji = text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
    if ((wr.emoji === "no" && emoji > 0) || (wr.emoji === "limited" && emoji > 1))
      ctx.out.add({
        check: "emoji",
        category: "vocabulary",
        severity: wr.emoji === "no" ? "warning" : "note",
        origin: "json",
        slide: b.slide,
        slot: b.slot,
        ...say("review.guard.finding.emoji", {
          ...where,
          count: String(emoji),
          rule: wr.emoji === "no" ? "no" : "limited",
        }),
        measured: emoji,
        threshold: wr.emoji === "no" ? 0 : 1,
        rule: {
          path: `${rulePath}/emoji`,
          text: wr.emoji === "no" ? "No emoji." : "Emoji used sparingly.",
        },
        blockHash: b.hash,
      });
    const bangs = text.match(/!/g)?.length ?? 0;
    if ((wr.exclamations === "no" && bangs > 0) || (wr.exclamations === "limited" && bangs > 1))
      ctx.out.add({
        check: "exclamation",
        category: "vocabulary",
        severity: wr.exclamations === "no" ? "warning" : "note",
        origin: "json",
        slide: b.slide,
        slot: b.slot,
        ...say("review.guard.finding.exclamation", {
          ...where,
          count: String(bangs),
          rule: wr.exclamations === "no" ? "no" : "limited",
        }),
        measured: bangs,
        threshold: wr.exclamations === "no" ? 0 : 1,
        rule: {
          path: `${rulePath}/exclamations`,
          text:
            wr.exclamations === "no"
              ? "No exclamation marks."
              : "Exclamation marks used sparingly.",
        },
        blockHash: b.hash,
      });
  }
  if (wr.maxHashtags !== undefined) {
    const tags = new Set(
      [
        ...(ctx.content.hashtags ?? []),
        ...((ctx.content.caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? []),
      ].map((t) => t.replace(/^#?/, "#").toLowerCase()),
    );
    if (tags.size > wr.maxHashtags)
      ctx.out.add({
        check: "hashtags",
        category: "vocabulary",
        severity: "warning",
        origin: "json",
        slide: null,
        slot: "caption",
        ...say("review.guard.finding.hashtags", {
          count: String(tags.size),
          max: String(wr.maxHashtags),
        }),
        measured: tags.size,
        threshold: wr.maxHashtags,
        rule: { path: `${rulePath}/maxHashtags`, text: `At most ${wr.maxHashtags} hashtags.` },
        blockHash: hash(ctx.content.caption, ctx.content.hashtags),
      });
  }
}

// ---------------------------------------------------------------- claims

/**
 * Wording that makes a claim someone may have to prove (superlatives, guarantees,
 * certifications, health and environmental claims). A match is a warning unless the
 * sentence repeats an approved message of the brand that carries its proof.
 * The patterns match Italian wording on purpose: client content is mostly Italian.
 */
export const SENSITIVE_CLAIMS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:\b(?:il|la|i|le)\s+|\bl')miglior[ei]?\b/giu, label: "superlative" },
  { pattern: /\bnumero\s*(?:1|uno)\b|\bn[.°º]?\s?1\b/giu, label: "ranking" },
  { pattern: /\bleader\b/giu, label: "ranking" },
  { pattern: /\bpiù\s+vendut[oaie]\b|\bbest\s?seller\b/giu, label: "ranking" },
  { pattern: /\bl'unic[oa]\b/giu, label: "exclusivity" },
  { pattern: /\bgarantit[oaie]\b|\bgaranzia\b/giu, label: "guarantee" },
  { pattern: /\b100\s?%/gu, label: "absolute" },
  { pattern: /\b(?:senza|zero)\s+rischi\b/giu, label: "absolute" },
  { pattern: /\bcertificat[oaie]\b|\bcertificazion[ei]\b/giu, label: "certification" },
  { pattern: /\bgratis\b|\bgratuit[oaie]\b/giu, label: "free" },
  {
    pattern:
      /\bclinicamente\b|\bscientificamente\s+provat[oaie]\b|\bdermatologicamente\b|\bguarisc[eo]\b/giu,
    label: "health",
  },
  {
    pattern:
      /\becologic[oaie]\b|\bsostenibil[ei]\b|\beco-?friendly\b|\bimpatto\s+zero\b|\bcarbon\s+neutral\b|\bbiodegradabil[ei]\b/giu,
    label: "environmental",
  },
];

function checkClaims(ctx: Ctx, blocks: Block[]) {
  const proven = ctx.doc.strategy.messages
    .filter((m) => !m.deprecated && m.value.proof?.trim())
    .map((m) => plainText(m.value.text).toLowerCase());
  for (const b of blocks) {
    const text = plainText(b.text);
    const sentences = text.split(/[.!?\n]+/u).map((s) => s.trim().toLowerCase());
    for (const { pattern, label } of SENSITIVE_CLAIMS)
      for (const m of text.matchAll(pattern)) {
        const found = m[0].trim();
        const sentence = sentences.find((s) => s.includes(found.toLowerCase()));
        if (sentence && proven.some((p) => p.includes(sentence) || sentence.includes(p))) continue;
        ctx.out.add({
          check: "sensitive_claim",
          category: "claims",
          severity: "warning",
          origin: "json",
          slide: b.slide,
          slot: b.slot,
          discriminator: found.toLowerCase(),
          ...say("review.guard.finding.sensitiveClaim", {
            ...at(b.slide, b.label),
            found,
            kind: label,
          }),
          measured: found,
          ...suggest("review.guard.suggestion.provenClaim"),
          rule: {
            path: "/document/strategy/messages",
            text: "Every claim carries its proof or its source.",
          },
          blockHash: b.hash,
        });
      }
  }
}

// Italian units and words on purpose: product facts are read from Italian client content.
const FACT_RE =
  /(\d+(?:[.,]\d+)*)\s?(%|€|euro|eur|anni|anno|mesi|mese|giorni|ore|kwh|kw|w|kg|g|cm|mm|m²|mq|m|litri|l|db|°c|gradi|bar|v|mah|gb|tb|pollici)(?![\p{L}\p{N}])/giu;

const UNIT_ALIASES: Record<string, string> = {
  euro: "€",
  eur: "€",
  anno: "anni",
  mese: "mesi",
  litri: "l",
  gradi: "°c",
  mq: "m²",
};

/** "1.200,50" and "1200.5" both become 1200.5; a lone "." before 3 digits is a thousands separator. */
export function parseNumber(raw: string): number {
  const s = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  return Number(s);
}

export function extractFacts(text: string): Array<{ raw: string; value: number; unit: string }> {
  const normalized = text.replace(/€\s?(\d+(?:[.,]\d+)*)/gu, "$1 €");
  return [...normalized.matchAll(FACT_RE)].map((m) => {
    const unit = m[2]!.toLowerCase();
    return { raw: m[0].trim(), value: parseNumber(m[1]!), unit: UNIT_ALIASES[unit] ?? unit };
  });
}

function checkProductFacts(ctx: Ctx, blocks: Block[]) {
  const product = ctx.content.product;
  if (!product) {
    ctx.notRun.push(notRunReason("product_fact", "review.guard.notRun.noProduct"));
    return;
  }
  const known = extractFacts([product.name, ...product.facts].join("\n"));
  const price = product.price ? extractFacts(product.price) : [];
  for (const b of blocks)
    for (const f of extractFacts(plainText(b.text))) {
      const where = { ...at(b.slide, b.label), found: f.raw, product: product.name };
      const base = {
        category: "claims" as CheckCategory,
        severity: "error" as BrandCheckSeverity,
        origin: "json" as const,
        slide: b.slide,
        slot: b.slot,
        discriminator: `${f.value}${f.unit}`,
        measured: f.raw,
        blockHash: b.hash,
      };
      if (f.unit === "€") {
        if (!price.length)
          ctx.out.add({
            ...base,
            check: "product_fact",
            ...say("review.guard.finding.priceNotInSheet", where),
          });
        else if (!ctx.content.brief?.asksPrice)
          ctx.out.add({
            ...base,
            check: "price_not_requested",
            ...say("review.guard.finding.priceNotRequested", where),
            ...suggest("review.guard.suggestion.removePrice"),
          });
        else if (!price.some((p) => p.value === f.value))
          ctx.out.add({
            ...base,
            check: "product_fact",
            ...say("review.guard.finding.priceMismatch", {
              ...where,
              price: product.price ?? "",
            }),
            threshold: product.price,
          });
        continue;
      }
      if (!known.some((k) => k.unit === f.unit && k.value === f.value))
        ctx.out.add({
          ...base,
          check: "product_fact",
          ...say("review.guard.finding.factNotInSheet", where),
          ...suggest("review.guard.suggestion.productData"),
        });
    }
}

// ---------------------------------------------------------------- visual

interface Palette {
  /** Every brand color by resolved hex, semantic roles first. */
  colors: Array<{ hex: string; role: string; label: string }>;
  fonts: string[];
  tokens: Map<string, unknown>;
}

const cleanFont = (f: string) =>
  f
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
const GENERIC_FONTS = new Set(["sans-serif", "serif", "monospace", "system-ui", "cursive"]);

function palette(brand: GuardBrand): Palette {
  const resolved = resolveTokens(brand.tokens);
  const colors: Palette["colors"] = [];
  for (const role of semanticColorRoles) {
    const hex = tokenColorHex(brand.tokens, role.path);
    if (hex) colors.push({ hex: hex.toUpperCase(), role: role.path, label: role.label });
  }
  for (const ref of referenceColors(brand.tokens))
    colors.push({
      hex: ref.hex.toUpperCase(),
      role: `color.reference.${ref.name}`,
      label: ref.name,
    });
  const fonts = new Set<string>();
  for (const [path, v] of resolved)
    if (path.startsWith("font.family."))
      for (const f of Array.isArray(v) ? v : [v]) fonts.add(cleanFont(String(f)));
  for (const t of brand.document.visual.typography) {
    fonts.add(cleanFont(t.value.family));
    for (const f of (t.value.fallback ?? "").split(",")) if (f.trim()) fonts.add(cleanFont(f));
  }
  return { colors, fonts: [...fonts], tokens: resolved };
}

function hexDistance(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
}

function resolveColor(pal: Palette, use: ColorUse | undefined): string | null {
  if (!use) return null;
  if (use.token) {
    const v = pal.tokens.get(use.token);
    if (v === undefined) return null;
    try {
      return colorToHex(v as never).toUpperCase();
    } catch {
      return null;
    }
  }
  return use.hex?.toUpperCase() ?? null;
}

/** Slot value of a slide background finding (kept in English: it is stored in the finding). */
const BACKGROUND = "Background";

function checkColors(ctx: Ctx, pal: Palette) {
  const visit = (i: number, where: string, use: ColorUse | undefined, h: string) => {
    if (!use) return;
    const place = {
      slide: String(i + 1),
      area: where === BACKGROUND ? "background" : "slot",
      slot: where,
    };
    if (use.token) {
      if (resolveColor(pal, use) === null)
        ctx.out.add({
          check: "off_brand_color",
          category: "visual",
          severity: "error",
          origin: "json",
          slide: i,
          slot: where,
          discriminator: use.token,
          ...say("review.guard.finding.colorRoleMissing", { ...place, token: use.token }),
          measured: use.token,
          blockHash: h,
        });
      return;
    }
    const hex = use.hex?.toUpperCase();
    if (!hex || pal.colors.some((c) => c.hex === hex)) return;
    const nearest = [...pal.colors].sort(
      (a, b) => hexDistance(a.hex, hex) - hexDistance(b.hex, hex),
    )[0];
    ctx.out.add({
      check: "off_brand_color",
      category: "visual",
      severity: "error",
      origin: "json",
      slide: i,
      slot: where,
      discriminator: hex,
      ...say("review.guard.finding.colorNotInPalette", { ...place, hex }),
      measured: hex,
      ...(nearest
        ? suggest("review.guard.suggestion.useRoleHex", { role: nearest.label, hex: nearest.hex })
        : {}),
      rule: { path: "/tokens/color", text: "Colors only from the Brand Identity roles." },
      blockHash: h,
    });
  };
  ctx.content.slides.forEach((slide, i) => {
    visit(i, BACKGROUND, slide.background, hash(slide.background));
    for (const s of slide.slots) {
      if (s.kind === "image") continue;
      visit(i, slotLabel(s), s.color, hash(s));
      visit(i, slotLabel(s), s.background, hash(s));
    }
  });
}

function checkFonts(ctx: Ctx, pal: Palette) {
  if (!pal.fonts.length) return;
  const brandFonts = ctx.doc.visual.typography.map((t) => `${t.value.family} (${t.value.role})`);
  ctx.content.slides.forEach((slide, i) => {
    for (const s of slide.slots) {
      if (s.kind === "image" || !s.fontFamily) continue;
      const shown = s.fontFamily.split(",")[0]!.trim();
      const first = cleanFont(shown);
      if (!first || GENERIC_FONTS.has(first) || pal.fonts.includes(first)) continue;
      ctx.out.add({
        check: "off_brand_font",
        category: "visual",
        severity: "error",
        origin: "json",
        slide: i,
        slot: s.name,
        discriminator: first,
        ...say("review.guard.finding.fontNotInBrand", {
          slide: String(i + 1),
          slot: slotLabel(s),
          font: shown,
        }),
        measured: s.fontFamily,
        ...(brandFonts.length
          ? suggest("review.guard.suggestion.brandFonts", { fonts: brandFonts.join(", ") })
          : {}),
        rule: {
          path: "/document/visual/typography",
          text: "Fonts only from the Brand Identity type scale.",
        },
        blockHash: hash(s),
      });
    }
  });
}

/** WCAG threshold for a slot, measured at the size it is seen (UXA-14). */
export function contrastThreshold(
  slot: { fontSizePx?: number | undefined; bold?: boolean | undefined },
  canvasWidth: number,
): number {
  if (!slot.fontSizePx) return WCAG.text;
  const at1080 = (slot.fontSizePx * DEFAULTS.referenceWidth) / canvasWidth;
  const large =
    at1080 >= DEFAULTS.largeTextPx || (!!slot.bold && at1080 >= DEFAULTS.largeBoldTextPx);
  return large ? WCAG.largeText : WCAG.text;
}

function betterTextRole(pal: Palette, bgHex: string, min: number) {
  return pal.colors
    .filter((c) => c.role.startsWith("color.semantic."))
    .map((c) => ({ ...c, ratio: checkContrast(c.hex, bgHex) }))
    .filter((c) => c.ratio >= min)
    .sort((a, b) => b.ratio - a.ratio)[0];
}

const contrastRule = {
  path: "/tokens/color/semantic",
  text: `Text ${formatRatio(WCAG.text)}, large text ${formatRatio(WCAG.largeText)}.`,
};

function checkTokenContrast(ctx: Ctx, pal: Palette) {
  // The render measures pixels: when a sample exists for a slot, it wins over the tokens.
  const rendered = new Set(
    (ctx.render?.slides ?? []).flatMap((s) =>
      (s.contrast ?? []).map((c) => `${s.slide}|${c.slot}`),
    ),
  );
  ctx.content.slides.forEach((slide, i) => {
    for (const s of slide.slots) {
      if (s.kind === "image" || !blockText(s).trim() || rendered.has(`${i}|${s.name}`)) continue;
      const fg = resolveColor(pal, s.color);
      const bg = resolveColor(pal, s.background ?? slide.background);
      if (!fg || !bg) continue;
      const ratio = checkContrast(fg, bg);
      const min = contrastThreshold(s, ctx.content.size.width);
      if (ratio >= min) continue;
      const better = betterTextRole(pal, bg, min);
      ctx.out.add({
        check: "contrast",
        category: "visual",
        severity: "error",
        origin: "json",
        slide: i,
        slot: s.name,
        ...say("review.guard.finding.contrast", {
          slide: String(i + 1),
          slot: slotLabel(s),
          ratio: formatRatio(ratio),
          fg,
          bg,
          min: formatRatio(min),
        }),
        measured: Number(ratio.toFixed(2)),
        threshold: min,
        ...(better ? suggest("review.guard.suggestion.useRole", { role: better.label }) : {}),
        rule: contrastRule,
        blockHash: hash(s, slide.background),
      });
    }
  });
}

function checkThumbnail(ctx: Ctx) {
  const title = titleSlot(ctx.content.slides[0]!);
  if (!title?.fontSizePx) return;
  const px = (title.fontSizePx * ctx.options.thumbnailWidth) / ctx.content.size.width;
  if (px < ctx.options.thumbnailMinPx)
    ctx.out.add({
      check: "thumbnail_legibility",
      category: "layout",
      severity: "warning",
      origin: "json",
      slide: 0,
      slot: title.name,
      ...say("review.guard.finding.thumbnail", {
        px: px.toFixed(1),
        min: String(ctx.options.thumbnailMinPx),
      }),
      measured: Number(px.toFixed(1)),
      threshold: ctx.options.thumbnailMinPx,
      ...suggest("review.guard.suggestion.thumbnail"),
      blockHash: hash(title),
    });
}

// ---------------------------------------------------------------- images

function lowRes(
  slide: number,
  slot: string,
  label: string,
  origin: "json" | "render",
  size: { w: number; h: number; slotWidth: number; ratio: number },
  blockHash: string,
): NewFinding {
  return {
    check: "low_resolution",
    category: "images",
    severity: size.ratio < 0.5 ? "error" : "warning",
    origin,
    slide,
    slot,
    ...say("review.guard.finding.lowResolution", {
      slide: String(slide + 1),
      slot: label,
      width: String(size.w),
      height: String(size.h),
      slotWidth: String(Math.round(size.slotWidth)),
    }),
    measured: `${size.w}×${size.h}`,
    threshold: Math.round(size.slotWidth),
    ...suggest("review.guard.suggestion.largerImage"),
    blockHash,
  };
}

function checkImages(ctx: Ctx) {
  const renderedSlides = new Set((ctx.render?.slides ?? []).map((s) => s.slide));
  ctx.content.slides.forEach((slide, i) => {
    const images = slide.slots.filter(
      (s): s is GuardImageSlot & { asset: NonNullable<GuardImageSlot["asset"]> } =>
        s.kind === "image" && !!s.asset,
    );
    for (const s of images) {
      const a = s.asset;
      const h = hash(s);
      if (a.origin === "ai" && a.approval !== "approved") {
        const rejected = a.approval === "rejected";
        ctx.out.add({
          check: rejected ? "ai_image_rejected" : "ai_image_unapproved",
          category: "images",
          severity: "error",
          origin: "json",
          slide: i,
          slot: s.name,
          ...say(
            rejected
              ? "review.guard.finding.aiImageRejected"
              : "review.guard.finding.aiImageUnapproved",
            { slide: String(i + 1), slot: slotLabel(s) },
          ),
          ...suggest(
            rejected
              ? "review.guard.suggestion.chooseAnother"
              : "review.guard.suggestion.approveOrReplace",
          ),
          blocksApproval: true,
          blockHash: h,
        });
      }
      // With a render, resolution is measured on the real slot size (checkRender).
      if (!renderedSlides.has(i) && s.slotWidth && s.slotHeight && a.width && a.height) {
        const ratio = Math.min(a.width / s.slotWidth, a.height / s.slotHeight);
        if (ratio < 1)
          ctx.out.add(
            lowRes(
              i,
              s.name,
              slotLabel(s),
              "json",
              { w: a.width, h: a.height, slotWidth: s.slotWidth, ratio },
              h,
            ),
          );
      }
    }
    const ai = images.some((s) => s.asset.origin === "ai");
    const real = images.some((s) => s.asset.origin === "photo" || s.asset.origin === "product");
    if (ai && real)
      ctx.out.add({
        check: "ai_next_to_photo",
        category: "images",
        severity: "warning",
        origin: "json",
        slide: i,
        slot: null,
        ...say("review.guard.finding.aiNextToPhoto", { slide: String(i + 1) }),
        blockHash: hash(images.map((s) => s.asset.id)),
      });
  });
}

// ---------------------------------------------------------------- render

function intersects(a: RenderSlot["rect"], b: RenderSlot["rect"]) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 2 && h > 2;
}

function checkRender(ctx: Ctx, pal: Palette) {
  if (!ctx.render) {
    ctx.notRun.push(notRunReason("render", "review.guard.notRun.render"));
    return;
  }
  for (const rs of ctx.render.slides) {
    const slide = ctx.content.slides[rs.slide];
    if (!slide) continue;
    const i = rs.slide;
    const bySlot = new Map(slide.slots.map((s) => [s.name, s]));
    const label = (name: string) => {
      const s = bySlot.get(name);
      return s ? slotLabel(s) : name;
    };
    const add = (
      m: RenderSlot,
      check: string,
      severity: BrandCheckSeverity,
      key: FindingKey,
      extra: Partial<NewFinding> = {},
      values: MessageValues = {},
    ) =>
      ctx.out.add({
        check,
        category: "layout",
        severity,
        origin: "render",
        slide: i,
        slot: m.name,
        ...say(key, { slide: String(i + 1), slot: label(m.name), ...values }),
        blockHash: hash(bySlot.get(m.name) ?? m.name, m.rect),
        ...extra,
      });
    for (const m of rs.slots) {
      const s = bySlot.get(m.name);
      if (m.kind === "text") {
        if (m.overflow)
          add(
            m,
            "text_overflow",
            "error",
            "review.guard.finding.textOverflow",
            suggest("review.guard.suggestion.shortenText"),
          );
        if (m.outsideSlide) add(m, "outside_slide", "error", "review.guard.finding.outsideSlide");
        else if (m.outsideSafe)
          add(
            m,
            "outside_safe_zone",
            s?.decorative ? "warning" : "error",
            "review.guard.finding.outsideSafe",
          );
        const maxLines = s?.kind === "text" ? s.maxLines : undefined;
        if (maxLines && m.lines > maxLines)
          add(
            m,
            "too_many_lines",
            "error",
            "review.guard.finding.tooManyLines",
            { measured: m.lines, threshold: maxLines },
            { count: String(m.lines), max: String(maxLines) },
          );
        continue;
      }
      if (!m.naturalWidth) {
        add(m, "image_missing", "error", "review.guard.finding.imageMissing", {
          category: "images",
        });
        continue;
      }
      const asset = s?.kind === "image" ? s.asset : undefined;
      if (asset?.origin === "logo" && (m.outsideSafe || m.outsideSlide))
        add(m, "outside_safe_zone", "error", "review.guard.finding.logoOutsideSafe");
      if (m.rect.width > 0 && m.rect.height > 0) {
        const ratio = Math.min(m.naturalWidth / m.rect.width, m.naturalHeight / m.rect.height);
        if (ratio < 1)
          ctx.out.add(
            lowRes(
              i,
              m.name,
              label(m.name),
              "render",
              { w: m.naturalWidth, h: m.naturalHeight, slotWidth: m.rect.width, ratio },
              hash(s ?? m.name),
            ),
          );
      }
    }
    const texts = rs.slots.filter((m) => m.kind === "text");
    for (let a = 0; a < texts.length; a++)
      for (let b = a + 1; b < texts.length; b++)
        if (intersects(texts[a]!.rect, texts[b]!.rect))
          add(
            texts[a]!,
            "overlap",
            "error",
            "review.guard.finding.overlap",
            { discriminator: texts[b]!.name },
            { other: label(texts[b]!.name) },
          );
    for (const c of rs.contrast ?? []) {
      const s = bySlot.get(c.slot);
      if (!s || s.kind === "image") continue;
      const ratio = checkContrast(c.fgHex, c.bgHex);
      const min = contrastThreshold(s, ctx.content.size.width);
      if (ratio >= min) continue;
      const onImage =
        !s.background && slide.slots.some((x) => x.kind === "image" && x.asset !== undefined);
      const better = betterTextRole(pal, c.bgHex.toUpperCase(), min);
      ctx.out.add({
        check: "contrast_on_render",
        category: "visual",
        severity: "error",
        origin: "render",
        slide: i,
        slot: c.slot,
        ...say("review.guard.finding.contrastOnRender", {
          slide: String(i + 1),
          slot: slotLabel(s),
          ratio: formatRatio(ratio),
          onImage: onImage ? "yes" : "no",
          min: formatRatio(min),
        }),
        measured: Number(ratio.toFixed(2)),
        threshold: min,
        ...(better
          ? suggest("review.guard.suggestion.useRoleOverlay", {
              role: better.label,
              onImage: onImage ? "yes" : "no",
            })
          : suggest("review.guard.suggestion.addOverlay")),
        rule: contrastRule,
        blockHash: hash(s, c.fgHex, c.bgHex),
      });
    }
  }
}

// ---------------------------------------------------------------- entry point

const SEVERITY_ORDER: Record<BrandCheckSeverity, number> = { error: 0, warning: 1, note: 2 };

export function countBySeverity(findings: readonly Pick<BrandCheckFinding, "severity">[]) {
  const counts: Record<BrandCheckSeverity, number> = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/**
 * Runs every rule-based check of the MVP on a content against a Brand Identity
 * version. Findings are sorted by slide (caption and whole-content last), then
 * severity, then check code.
 */
export function checkContent(
  content: GuardContent,
  brand: GuardBrand,
  render?: GuardRender,
  options: CheckOptions = {},
): BrandCheckReport {
  const ctx: Ctx = {
    content,
    doc: brand.document,
    render,
    out: new Findings(),
    options: {
      thumbnailWidth: options.thumbnailWidth ?? DEFAULTS.thumbnailWidth,
      thumbnailMinPx: options.thumbnailMinPx ?? DEFAULTS.thumbnailMinPx,
      defaultHookMaxWords: options.defaultHookMaxWords ?? DEFAULTS.defaultHookMaxWords,
    },
    notRun: [],
  };
  const blocks = textBlocks(content);
  const pal = palette(brand);

  checkLengths(ctx);
  checkDensity(ctx);
  checkHook(ctx);
  checkCta(ctx);
  checkStructure(ctx);
  checkForbiddenWords(ctx, blocks);
  checkSpellings(ctx, blocks);
  checkAvoidTopics(ctx, blocks);
  checkWritingRules(ctx, blocks);
  checkClaims(ctx, blocks);
  checkProductFacts(ctx, blocks);
  checkColors(ctx, pal);
  checkFonts(ctx, pal);
  checkTokenContrast(ctx, pal);
  checkThumbnail(ctx);
  checkImages(ctx);
  checkRender(ctx, pal);
  if (!render && options.flagUnverifiedRender)
    ctx.out.add({
      check: RENDER_UNVERIFIED,
      category: "layout",
      severity: "warning",
      origin: "json",
      slide: null,
      slot: null,
      ...say("review.guard.finding.renderUnverified"),
      blockHash: hash(RENDER_UNVERIFIED),
    });
  ctx.notRun.push(notRunReason("reviewer_judgement", "review.guard.notRun.reviewer"));

  const order = (s: number | null) => (s === null ? Number.MAX_SAFE_INTEGER : s);
  const findings = ctx.out.list.sort(
    (a, b) =>
      order(a.slide) - order(b.slide) ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.check.localeCompare(b.check) ||
      a.key.localeCompare(b.key),
  );
  return {
    brandIdentityVersionId: brand.versionId,
    brandIdentityVersionNumber: brand.number,
    checkedAt: (options.now ?? new Date()).toISOString(),
    hasRender: !!render,
    findings,
    counts: countBySeverity(findings),
    coherence: coherenceScore(findings),
    notRun: ctx.notRun,
  };
}
