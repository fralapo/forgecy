/**
 * Deterministic checks of a carousel (page 46). Errors block “Send for review”;
 * warnings need a “Seen” from the reviewer before approval. Ids are stable for
 * the same problem, so an acknowledgement survives a reload but not a new problem.
 * The full Brand Guard (AI review against the Brand Identity) arrives with M6.
 * Browser-safe: the editor runs the same checks live.
 */
import {
  buildCarouselSchema,
  slideRuleOf,
  findLayout,
  visibleLength,
  type TemplateManifest,
} from "@forgecy/carousel";
import type { AssetSource, MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import {
  captionBudget,
  captionLimits,
  toRenderSlide,
  type CaptionLength,
  type ClaimFinding,
  type CarouselDocument,
  type ContentChannel,
} from "../document";
import { channelLabels } from "../labels";
import {
  addressForm,
  voiceOf,
  creditBeforeHashtags,
  denseRuns,
  findAiTells,
  findPlaceholder,
  hashtagSet,
  wordCount,
} from "./copy-lint";
import { factInCopy } from "./facts";
import type { ProductFactRef } from "../products";

/** A body slide with at least this many words in its text counts as dense for the rhythm check. */
const DENSE_WORDS = 35;
/** Same tone on this many slides in a row, in a deck that does vary tone, reads as a missed alternation. */
const TONE_RUN = 5;
/** Instagram carousels perform best with exactly this many discovery hashtags. */
const INSTAGRAM_HASHTAGS = 3;

/**
 * A caption cut to `limit` visible characters, at the last word break when one falls
 * in the final fifth (the editor's “Trim to limit”). Shorter captions come back as is.
 */
export function trimCaptionToLimit(caption: string, limit: number): string {
  if (visibleLength(caption) <= limit) return caption;
  const chars = [...caption];
  const cut = chars.slice(0, limit);
  let end = cut.length;
  for (let i = cut.length - 1; i >= Math.floor(cut.length * 0.8); i--) {
    if (/\s/.test(cut[i]!)) {
      end = i;
      break;
    }
  }
  return cut.slice(0, end).join("").trimEnd();
}

export type CheckSeverity = "error" | "warning";

export interface ContentCheck {
  id: string;
  severity: CheckSeverity;
  /** English text (stored with errors, logs); `ref` is the same message for the interface. */
  message: string;
  ref?: MessageRef;
  slideId?: string;
}

type CheckKey = Extract<MessageKey, `review.checks.${string}`>;
const say = (key: CheckKey, values?: MessageValues) => ({
  message: englishMessage(key, values),
  ref: messageRef(key, values),
});

/** The check text of a slide-schema issue; Zod's own issues keep their English text. */
function slideIssueText(issue: { message: string; params?: unknown }, slide: number | undefined) {
  const rule = slideRuleOf(issue);
  if (rule)
    return say(`review.checks.slideRule.${rule.rule}`, { ...rule.values, slide: slide ?? 0 });
  return slide
    ? say("review.checks.slideIssue", { slide, issue: issue.message })
    : { message: issue.message };
}

export interface AssetInfo {
  status: "draft" | "approved" | "rejected";
  source: AssetSource;
  /** AI image whose provider terms are not verified, or an upload whose rights nobody confirmed. */
  commercialUsePending?: boolean;
  alt: string;
}

export interface CheckInput {
  document: CarouselDocument;
  manifest: TemplateManifest | null;
  channel: ContentChannel;
  forbiddenWords?: readonly string[];
  maxHashtags?: number;
  /** Library assets by storage key. */
  assets?: ReadonlyMap<string, AssetInfo>;
  usePrice?: boolean;
  wantsAltText?: boolean;
  /**
   * Everything the copy may draw numbers from (brief, product sheet). When given, a figure in
   * the slides or caption that is not in it is flagged: the writer never invents data.
   */
  sourceText?: string;
  /** Product revision the copy was written with, and the catalog's current one. */
  productRevision?: { used: number | null; current: number | null } | null;
  brandVersion?: { used: string | null; current: string | null } | null;
  /** Caption tier of the brief; when given, a caption well over its budget is flagged. */
  captionLength?: CaptionLength;
  /** Claims the AI critic flagged, shown as warnings while their words are still in the copy. */
  claims?: readonly ClaimFinding[];
  /** Language of the deliverable; the copy lint runs for the languages it has patterns for. */
  language?: string;
  /** Form of address of the Brand Identity writing rules; “tu” and “voi” are checked. */
  person?: "tu" | "lei" | "voi" | "noi" | "impersonale";
  /** Brand severity of the AI-tells lint (default warning); `dash` falls back to it. */
  aiTellsSeverity?: "off" | "warning" | "error";
  dashSeverity?: "off" | "warning" | "error";
  /** Stock image credit lines that the caption must carry before its hashtags. */
  credits?: readonly string[];
  /**
   * Fact bank of the product: a `do_not_use` fact in the copy is an error, a `pending_client`
   * one a warning (use `factBankOf` to split a product's facts).
   */
  facts?: { doNotUse: readonly ProductFactRef[]; pending: readonly ProductFactRef[] };
  /** Brief parts that gate the export: open client questions and phrases the copy must not use. */
  brief?: {
    openQuestions?: readonly { text: string; resolved: boolean }[];
    cannotSay?: readonly { text: string; reason?: string }[];
  };
}

/** Figures that read as data: two or more digits, or any amount with %, a currency or a unit sign. */
const FIGURE = /\d[\d.,]*\d|\d(?=\s?[%€$£])/g;
const digitsOf = (figure: string) => figure.replace(/\D/g, "");

/** Digit runs of a text with separators removed, so “1.200” and “1,200” match “1200”. */
function figuresIn(text: string): Set<string> {
  return new Set((text.match(FIGURE) ?? []).map(digitsOf).filter(Boolean));
}

/** The text the copy may take figures from: the brief and, when there is one, the product sheet. */
export function sourceTextOf(brief: unknown, product?: unknown): string {
  return JSON.stringify([brief, product ?? null]);
}

const PRICE = /(€\s?\d|\d[\d.,]*\s?(€|eur\b|euro\b))/i;

export function slotTexts(slots: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const v of Object.values(slots)) {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

function wordRegex(word: string): RegExp {
  const esc = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu");
}

/** Whitespace and case folded, so a quote still matches after a line break or capital changes. */
export const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

export function computeChecks(input: CheckInput): ContentCheck[] {
  const { document: doc, manifest } = input;
  const out: ContentCheck[] = [];
  const add = (c: ContentCheck) => {
    if (!out.some((x) => x.id === c.id)) out.push(c);
  };

  if (!doc.slides.length) {
    add({ id: "slides:empty", severity: "error", ...say("review.checks.noSlides") });
    return out;
  }

  if (!manifest) {
    add({ id: "template:missing", severity: "error", ...say("review.checks.templateMissing") });
  } else {
    const r = buildCarouselSchema(manifest).safeParse(doc.slides.map(toRenderSlide));
    if (!r.success)
      for (const issue of r.error.issues) {
        const idx = typeof issue.path[0] === "number" ? issue.path[0] : undefined;
        const slide = idx !== undefined ? doc.slides[idx] : undefined;
        add({
          id: `template:${slide?.id ?? "all"}:${issue.path.slice(1).join(".") || "slides"}`,
          severity: "error",
          ...slideIssueText(issue, slide ? idx! + 1 : undefined),
          ...(slide ? { slideId: slide.id } : {}),
        });
      }
    const last = doc.slides.at(-1)!;
    if (
      manifest.layouts.some((l) => l.role === "cta") &&
      findLayout(manifest, last.layout)?.role !== "cta"
    )
      add({
        id: "cta:last",
        severity: "warning",
        ...say("review.checks.lastNotCta"),
        slideId: last.id,
      });
  }

  const limit = captionLimits[input.channel];
  const captionLen = visibleLength(doc.caption);
  if (captionLen > limit)
    add({
      id: "caption:length",
      severity: "warning",
      ...say("review.checks.captionLength", {
        count: String(captionLen),
        channel: channelLabels[input.channel],
        max: String(limit),
      }),
    });
  if (input.captionLength && captionLen <= limit) {
    const budget = captionBudget(input.channel, input.captionLength);
    // 20% of slack: the tier is a target for the writer, not a limit.
    if (captionLen > budget * 1.2)
      add({
        id: "caption:tier",
        severity: "warning",
        ...say("review.checks.captionTier", {
          count: String(captionLen),
          tier: input.captionLength,
          max: String(budget),
        }),
      });
  }
  if (input.maxHashtags !== undefined && doc.hashtags.length > input.maxHashtags)
    add({
      id: "hashtags:max",
      severity: "warning",
      ...say("review.checks.hashtags", {
        count: String(doc.hashtags.length),
        max: String(input.maxHashtags),
      }),
    });

  const words = (input.forbiddenWords ?? []).filter((w) => w.trim().length > 1);
  const texts: { slideId?: string; text: string }[] = [
    ...doc.slides.flatMap((s) => slotTexts(s.slots).map((text) => ({ slideId: s.id, text }))),
    { text: doc.caption },
    { text: doc.title },
  ];
  for (const w of words) {
    const re = wordRegex(w);
    for (const t of texts)
      if (re.test(t.text))
        add({
          id: `forbidden:${t.slideId ?? "caption"}:${w.toLowerCase()}`,
          severity: "warning",
          ...say("review.checks.forbiddenWord", { word: w }),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
  }

  const openQuestions = (input.brief?.openQuestions ?? []).filter((q) => !q.resolved);
  if (openQuestions.length)
    add({
      id: "brief:open-questions",
      severity: "error",
      ...say("review.checks.openQuestions", { count: String(openQuestions.length) }),
    });
  for (const phrase of input.brief?.cannotSay ?? []) {
    const needle = squash(phrase.text);
    if (!needle) continue;
    for (const t of texts)
      if (squash(t.text).includes(needle))
        add({
          id: `brief:cannot-say:${needle}:${t.slideId ?? "caption"}`,
          severity: "error",
          ...say("review.checks.cannotSay", {
            phrase: phrase.text,
            slide: t.slideId
              ? String(doc.slides.findIndex((s) => s.id === t.slideId) + 1)
              : "caption",
          }),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
  }

  for (const [bucket, severity, key] of [
    [input.facts?.doNotUse, "error", "doNotUse"],
    [input.facts?.pending, "warning", "pending"],
  ] as const)
    for (const fact of bucket ?? [])
      for (const t of texts) {
        if (!t.slideId && t.text === doc.title) continue;
        if (!factInCopy(t.text, fact)) continue;
        add({
          id: `facts:${key === "doNotUse" ? "do-not-use" : "pending"}:${squash(fact.text)}:${t.slideId ?? "caption"}`,
          severity,
          ...say(key === "doNotUse" ? "review.checks.factDoNotUse" : "review.checks.factPending", {
            fact: fact.text,
            slide: t.slideId
              ? String(doc.slides.findIndex((s) => s.id === t.slideId) + 1)
              : "caption",
          }),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
      }

  const where = (t: { slideId?: string }) => ({
    slide: t.slideId ? String(doc.slides.findIndex((s) => s.id === t.slideId) + 1) : "caption",
  });
  for (const t of texts) {
    if (!t.slideId && t.text === doc.title) continue;
    const key = t.slideId ?? "caption";
    const marker = findPlaceholder(t.text);
    if (marker)
      add({
        id: `placeholder:${key}`,
        severity: "error",
        ...say("review.checks.placeholder", { ...where(t), match: marker }),
        ...(t.slideId ? { slideId: t.slideId } : {}),
      });
    for (const tell of findAiTells(t.text, input.language ?? "")) {
      const level =
        (tell.kind === "dash" ? input.dashSeverity : undefined) ??
        input.aiTellsSeverity ??
        "warning";
      if (level === "off") continue;
      add({
        id: `aitell:${tell.kind}:${key}`,
        severity: level,
        ...say("review.checks.aiTell", { ...where(t), kind: tell.kind, match: tell.match }),
        ...(t.slideId ? { slideId: t.slideId } : {}),
      });
    }
    const form =
      input.person === "tu" || input.person === "voi"
        ? addressForm(t.text, input.language ?? "")
        : null;
    if (form && form !== input.person)
      add({
        id: `person:${key}`,
        severity: "warning",
        ...say("review.checks.person", { ...where(t), expected: input.person! }),
        ...(t.slideId ? { slideId: t.slideId } : {}),
      });
    // English: “tu”, “voi” and “lei” read as “you”, “noi” as “we”; the impersonal form is not checked.
    const wanted =
      input.person === "noi" ? "we" : input.person && input.person !== "impersonale" ? "you" : null;
    const voice = wanted ? voiceOf(t.text, input.language ?? "") : null;
    if (voice && wanted && voice !== wanted)
      add({
        id: `voice:${key}`,
        severity: "warning",
        ...say("review.checks.voice", { ...where(t), expected: wanted, found: voice }),
        ...(t.slideId ? { slideId: t.slideId } : {}),
      });
  }

  if (input.channel === "instagram") {
    const count = hashtagSet(doc.hashtags, doc.caption).size;
    if (count !== INSTAGRAM_HASHTAGS)
      add({
        id: "caption:hashtags",
        severity: "warning",
        ...say("review.checks.hashtagsExact", {
          count: String(count),
          target: String(INSTAGRAM_HASHTAGS),
        }),
      });
  }
  for (const credit of input.credits ?? [])
    if (!creditBeforeHashtags(doc.caption, credit))
      add({
        id: `caption:credit:${credit.toLowerCase()}`,
        severity: "warning",
        ...say("review.checks.captionCredit", { credit }),
      });

  if (manifest) {
    const dense = doc.slides.map((s) => {
      const role = findLayout(manifest, s.layout)?.role;
      return (
        role !== undefined &&
        role !== "cover" &&
        role !== "cta" &&
        slotTexts(s.slots).reduce((n, t) => n + wordCount(t), 0) >= DENSE_WORDS
      );
    });
    for (const [from, to] of denseRuns(dense))
      add({
        id: `rhythm:${doc.slides[from]!.id}`,
        severity: "warning",
        ...say("review.checks.rhythm", {
          from: String(from + 1),
          to: String(to + 1),
          count: String(to - from + 1),
        }),
        slideId: doc.slides[from]!.id,
      });
  }

  // Only a deck that varies tone somewhere is pacing with it; all-default stays silent.
  if (new Set(doc.slides.map((s) => s.tone)).size >= 2) {
    for (let i = 0; i < doc.slides.length;) {
      let j = i;
      while (j + 1 < doc.slides.length && doc.slides[j + 1]!.tone === doc.slides[i]!.tone) j++;
      if (j - i + 1 >= TONE_RUN)
        add({
          id: `rhythm:tone:${doc.slides[i]!.id}`,
          severity: "warning",
          ...say("review.checks.toneRhythm", {
            from: String(i + 1),
            to: String(j + 1),
            count: String(j - i + 1),
            tone: doc.slides[i]!.tone,
          }),
          slideId: doc.slides[i]!.id,
        });
      i = j + 1;
    }
  }

  if (!input.usePrice)
    for (const t of texts)
      if (PRICE.test(t.text))
        add({
          id: `price:${t.slideId ?? "caption"}`,
          severity: "warning",
          ...say("review.checks.price"),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });

  if (input.sourceText !== undefined) {
    const known = figuresIn(input.sourceText);
    for (const t of texts)
      for (const figure of t.text.match(FIGURE) ?? []) {
        const digits = digitsOf(figure);
        if (known.has(digits)) continue;
        add({
          id: `numbers:unsourced:${t.slideId ?? "caption"}:${digits}`,
          severity: "warning",
          ...say("review.checks.unsourcedNumber", { number: figure }),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
      }
  }

  const perSlide = new Map<string, number>();
  for (const f of input.claims ?? []) {
    const index = f.slideId ? doc.slides.findIndex((s) => s.id === f.slideId) : -1;
    if (f.slideId && index < 0) continue;
    const copy = f.slideId ? slotTexts(doc.slides[index]!.slots) : [doc.caption];
    if (!copy.some((t) => squash(t).includes(squash(f.quote)))) continue;
    const key = f.slideId ?? "caption";
    const n = (perSlide.get(key) ?? 0) + 1;
    perSlide.set(key, n);
    add({
      id: `claim:${key}:${n}`,
      severity: "warning",
      ...say("review.checks.claim", {
        slide: f.slideId ? String(index + 1) : "caption",
        kind: f.kind,
        risk: f.risk,
        quote: f.quote,
        reason: f.reason,
      }),
      ...(f.slideId ? { slideId: f.slideId } : {}),
    });
  }

  const assets = input.assets ?? new Map<string, AssetInfo>();
  doc.slides.forEach((s, i) => {
    for (const [slot, v] of Object.entries(s.slots)) {
      if (!v || typeof v !== "object" || Array.isArray(v) || !v.key) continue;
      const a = assets.get(v.key);
      const slide = String(i + 1);
      if (!a) {
        add({
          id: `asset:missing:${s.id}:${slot}`,
          severity: "error",
          ...say("review.checks.assetMissing", { slide }),
          slideId: s.id,
        });
        continue;
      }
      if (a.status !== "approved")
        add({
          id: `asset:unapproved:${s.id}:${slot}`,
          severity: "error",
          ...say(
            a.source === "ai" ? "review.checks.aiAssetUnapproved" : "review.checks.assetUnapproved",
            { slide },
          ),
          slideId: s.id,
        });
      if (a.commercialUsePending)
        add({
          id: `asset:commercial:${s.id}:${slot}`,
          severity: "warning",
          ...say("review.checks.commercialUse", { slide }),
          slideId: s.id,
        });
      if (input.wantsAltText && !(v.alt || a.alt).trim())
        add({
          id: `asset:alt:${s.id}:${slot}`,
          severity: "warning",
          ...say("review.checks.altMissing", { slide }),
          slideId: s.id,
        });
    }
  });

  const pr = input.productRevision;
  if (pr && pr.used !== null && pr.current !== null && pr.current > pr.used)
    add({
      id: `product:changed:${pr.current}`,
      severity: "warning",
      ...say("review.checks.productChanged"),
    });
  const bv = input.brandVersion;
  if (bv && bv.used && bv.current && bv.used !== bv.current)
    add({
      id: `brand:changed:${bv.current}`,
      severity: "warning",
      ...say("review.checks.brandChanged"),
    });

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export const blockingChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "error");
export const warningChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "warning");
