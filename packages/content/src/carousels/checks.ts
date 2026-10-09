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
  captionLimits,
  toRenderSlide,
  type CarouselDocument,
  type ContentChannel,
} from "../document";
import { channelLabels } from "../labels";

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
  /** Product revision the copy was written with, and the catalog's current one. */
  productRevision?: { used: number | null; current: number | null } | null;
  brandVersion?: { used: string | null; current: string | null } | null;
}

const PRICE = /(€\s?\d|\d[\d.,]*\s?(€|eur\b|euro\b))/i;

function slotTexts(slots: Record<string, unknown>): string[] {
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

  if (!input.usePrice)
    for (const t of texts)
      if (PRICE.test(t.text))
        add({
          id: `price:${t.slideId ?? "caption"}`,
          severity: "warning",
          ...say("review.checks.price"),
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });

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
