/**
 * Deterministic checks of a carousel (page 46). Errors block «Invia in revisione»;
 * warnings need a «Ho visto» from the reviewer before approval. Ids are stable for
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
    add({ id: "slides:empty", severity: "error", message: "Il carosello non ha slide" });
    return out;
  }

  if (!manifest) {
    add({ id: "template:missing", severity: "error", message: "Template non disponibile" });
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
        message: "L'ultima slide non è una call to action",
        slideId: last.id,
      });
  }

  const limit = captionLimits[input.channel];
  const captionLen = visibleLength(doc.caption);
  if (captionLen > limit)
    add({
      id: "caption:length",
      severity: "error",
      message: `Didascalia di ${captionLen} caratteri: il limite di ${input.channel === "linkedin" ? "LinkedIn" : "Instagram"} è ${limit}`,
    });
  if (input.maxHashtags !== undefined && doc.hashtags.length > input.maxHashtags)
    add({
      id: "hashtags:max",
      severity: "warning",
      message: `${doc.hashtags.length} hashtag: la Brand Identity ne prevede al massimo ${input.maxHashtags}`,
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
          message: `Parola vietata dalla Brand Identity: «${w}»`,
          ...(t.slideId ? { slideId: t.slideId } : {}),
        });
  }

  if (!input.usePrice)
    for (const t of texts)
      if (PRICE.test(t.text))
        add({
          id: `price:${t.slideId ?? "caption"}`,
          severity: "warning",
          message: "Il testo cita un prezzo ma il brief non lo prevede",
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
          message: `${where}: immagine non presente nella libreria del cliente`,
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
              ? `${where}: immagine AI da approvare prima dell'approvazione del carosello`
              : `${where}: immagine non approvata`,
          slideId: s.id,
        });
      if (a.source === "ai" && a.commercialUsePending)
        add({
          id: `asset:commercial:${s.id}:${slot}`,
          severity: "warning",
          message: `${where}: uso commerciale del fornitore dell'immagine AI non ancora verificato`,
          slideId: s.id,
        });
      if (input.wantsAltText && !(v.alt || a.alt).trim())
        add({
          id: `asset:alt:${s.id}:${slot}`,
          severity: "warning",
          message: `${where}: manca il testo alternativo dell'immagine`,
          slideId: s.id,
        });
    }
  });

  const pr = input.productRevision;
  if (pr && pr.used !== null && pr.current !== null && pr.current > pr.used)
    add({
      id: `product:changed:${pr.current}`,
      severity: "warning",
      message: "Il prodotto è cambiato nel catalogo dopo la scrittura dei testi",
    });
  const bv = input.brandVersion;
  if (bv && bv.used && bv.current && bv.used !== bv.current)
    add({
      id: `brand:changed:${bv.current}`,
      severity: "warning",
      message: "È stata pubblicata una nuova Brand Identity dopo la creazione del carosello",
    });

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export const blockingChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "error");
export const warningChecks = (checks: readonly ContentCheck[]) =>
  checks.filter((c) => c.severity === "warning");
