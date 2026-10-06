/**
 * Deterministic checks of a carousel (page 46). Errors block “Send for review”;
 * warnings need a “Seen” from the reviewer before approval. Ids are stable for
 * the same problem, so an acknowledgement survives a reload but not a new problem.
 * The full Brand Guard (AI review against the Brand Identity) arrives with M6.
 * Browser-safe: the editor runs the same checks live.
 */
import {
  buildCarouselSchema,
  findLayout,
  visibleLength,
  type TemplateManifest,
} from "@forgecy/carousel";
import {
  captionLimits,
  toRenderSlide,
  type CarouselDocument,
  type ContentChannel,
} from "./document";

export type CheckSeverity = "error" | "warning";

export interface ContentCheck {
  id: string;
  severity: CheckSeverity;
  message: string;
  slideId?: string;
}

export interface AssetInfo {
  status: "draft" | "approved" | "rejected";
  source: "upload" | "ai" | "product";
  /** For AI images: commercial use of the provider not yet verified by the agency. */
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
    add({ id: "slides:empty", severity: "error", message: "The carousel has no slides" });
    return out;
  }

  if (!manifest) {
    add({ id: "template:missing", severity: "error", message: "Template not available" });
  } else {
    const r = buildCarouselSchema(manifest).safeParse(doc.slides.map(toRenderSlide));
    if (!r.success)
      for (const issue of r.error.issues) {
        const idx = typeof issue.path[0] === "number" ? issue.path[0] : undefined;
        const slide = idx !== undefined ? doc.slides[idx] : undefined;
        add({
          id: `template:${slide?.id ?? "all"}:${issue.path.slice(1).join(".") || "slides"}`,
          severity: "error",
          message: slide ? `Slide ${idx! + 1}: ${issue.message}` : issue.message,
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
        message: "The last slide is not a call to action",
        slideId: last.id,
      });
  }

  const limit = captionLimits[input.channel];
  const captionLen = visibleLength(doc.caption);
  if (captionLen > limit)
    add({
      id: "caption:length",
      severity: "error",
      message: `Caption of ${captionLen} characters: the ${input.channel === "linkedin" ? "LinkedIn" : "Instagram"} limit is ${limit}`,
    });
  if (input.maxHashtags !== undefined && doc.hashtags.length > input.maxHashtags)
    add({
      id: "hashtags:max",
      severity: "warning",
      message: `${doc.hashtags.length} hashtags: the Brand Identity allows at most ${input.maxHashtags}`,
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
          message: `Word forbidden by the Brand Identity: “${w}”`,
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
  }

  if (!input.usePrice)
    for (const t of texts)
      if (PRICE.test(t.text))
        add({
          id: `price:${t.slideId ?? "caption"}`,
          severity: "warning",
          message: "The copy mentions a price but the brief does not allow it",
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });

  const assets = input.assets ?? new Map<string, AssetInfo>();
  doc.slides.forEach((s, i) => {
    for (const [slot, v] of Object.entries(s.slots)) {
      if (!v || typeof v !== "object" || Array.isArray(v) || !v.key) continue;
      const a = assets.get(v.key);
      const where = `Slide ${i + 1}`;
      if (!a) {
        add({
          id: `asset:missing:${s.id}:${slot}`,
          severity: "error",
          message: `${where}: image not in the client's library`,
          slideId: s.id,
        });
        continue;
      }
      if (a.status !== "approved")
        add({
          id: `asset:unapproved:${s.id}:${slot}`,
          severity: "error",
          message:
            a.source === "ai"
              ? `${where}: AI image to approve before the carousel is approved`
              : `${where}: image not approved`,
          slideId: s.id,
        });
      if (a.source === "ai" && a.commercialUsePending)
        add({
          id: `asset:commercial:${s.id}:${slot}`,
          severity: "warning",
          message: `${where}: commercial use of the AI image provider not verified yet`,
          slideId: s.id,
        });
      if (input.wantsAltText && !(v.alt || a.alt).trim())
        add({
          id: `asset:alt:${s.id}:${slot}`,
          severity: "warning",
          message: `${where}: the image alt text is missing`,
          slideId: s.id,
        });
    }
  });

  const pr = input.productRevision;
  if (pr && pr.used !== null && pr.current !== null && pr.current > pr.used)
    add({
      id: `product:changed:${pr.current}`,
      severity: "warning",
      message: "The product changed in the catalog after the copy was written",
    });
  const bv = input.brandVersion;
  if (bv && bv.used && bv.current && bv.used !== bv.current)
    add({
      id: `brand:changed:${bv.current}`,
      severity: "warning",
      message: "A new Brand Identity was published after the carousel was created",
    });

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export const blockingChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "error");
export const warningChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "warning");
