/**
 * Brand Guard (M6) seen from the Contents module. The guard lives in its own
 * package; the apps register it with `setBrandGuard` so this package does not
 * depend on it. When none is registered, carousels keep the module's own checks.
 *
 * Wiring, once @forgecy/brand-guard is installed (web and worker):
 *   setBrandGuard({ run: runBrandCheck, get: getBrandCheck, confirmForApproval: confirmBrandCheckForApproval });
 */
import { FORMATS, findLayout, type TemplateManifest } from "@forgecy/carousel";
import type { Actor } from "@forgecy/core";
import type { Database } from "@forgecy/db";
import type { Executor } from "./access";
import type { CarouselDocument, ContentChannel } from "./document";
import type { ProductSummary } from "./products";

// ---- Input (same shape as the guard's GuardContent) ----

type ColorUse = { token?: string; hex?: string };

export type GuardSlotInput =
  | {
      kind: "text";
      name: string;
      label?: string;
      role?: "title" | "subtitle" | "body" | "cta" | "label" | "other";
      text: string;
      maxChars?: number;
      maxLines?: number;
      color?: ColorUse;
    }
  | {
      kind: "list";
      name: string;
      label?: string;
      items: string[];
      maxItems?: number;
      maxCharsPerItem?: number;
    }
  | {
      kind: "image";
      name: string;
      label?: string;
      asset?: {
        id: string;
        origin: "ai" | "photo" | "product" | "upload" | "logo" | "illustration";
        approval?: "draft" | "approved" | "rejected";
        width: number;
        height: number;
      };
    };

export interface GuardContentInput {
  channel?: ContentChannel;
  formatKey?: string;
  size: { width: number; height: number };
  slides: Array<{
    layout: string;
    role?: "cover" | "content" | "cta" | "closing";
    slots: GuardSlotInput[];
  }>;
  caption?: string;
  hashtags?: string[];
  product?: { name: string; facts: string[]; price?: string };
  brief?: { asksPrice?: boolean };
}

// ---- Output (the parts of the guard's report this module shows) ----

export type GuardBand = "critico" | "debole" | "discreto" | "buono" | "eccellente";
export type GuardSeverity = "error" | "warning" | "note";

export interface GuardFinding {
  key: string;
  check: string;
  category: string;
  severity: GuardSeverity;
  slide: number | null;
  slot: string | null;
  message: string;
  suggestion?: string;
  blocksApproval?: boolean;
  status: "open" | "ignored";
  acknowledged?: { by: string; at: string };
}

export interface GuardReport {
  checkedAt: string;
  findings: GuardFinding[];
  /** Only the band is shown: no numeric scores in the MVP (UX spec 12.6). */
  coherence: { band: GuardBand };
  notRun: Array<{ check: string; reason: string }>;
}

export interface GuardSubject {
  type: string;
  id: string;
  version?: number | null;
}

export interface BrandGuardPort {
  run(
    db: Database,
    actor: Actor,
    input: {
      clientId: string;
      subject: GuardSubject;
      content: GuardContentInput;
      brandVersionId?: string;
    },
  ): Promise<{ report: GuardReport }>;
  get(
    db: Database,
    actor: Actor,
    input: { clientId: string; subject: GuardSubject },
  ): Promise<{ subjectVersion: number | null; report: GuardReport } | null>;
  /** Inside the approve transaction; throws with details.code when approval is not allowed. */
  confirmForApproval(
    tx: Executor,
    actor: Actor,
    input: {
      clientId: string;
      subject: GuardSubject & { version: number };
      acknowledgedKeys: string[];
    },
  ): Promise<unknown>;
}

let guard: BrandGuardPort | null = null;

export function setBrandGuard(port: BrandGuardPort | null): void {
  guard = port;
}

export function brandGuard(): BrandGuardPort | null {
  return guard;
}

/**
 * Checks the guard owns once it is registered: the module drops its own copy so
 * people never confirm the same problem twice.
 */
export const GUARDED_CHECK_PREFIXES = ["forbidden:", "cta:", "hashtags:", "price:"] as const;

export const carouselSubject = (contentId: string, version?: number | null): GuardSubject => ({
  type: "carousel",
  id: contentId,
  ...(version === undefined ? {} : { version }),
});

// ---- Mapper ----

export interface GuardAssetInfo {
  id: string;
  source: "upload" | "ai" | "product";
  status: "draft" | "approved" | "rejected";
  width: number | null;
  height: number | null;
}

const TEXT_ROLES: Record<string, NonNullable<Extract<GuardSlotInput, { kind: "text" }>["role"]>> = {
  title: "title",
  headline: "title",
  subtitle: "subtitle",
  kicker: "label",
  label: "label",
  eyebrow: "label",
  body: "body",
  text: "body",
  action: "cta",
  cta: "cta",
  button: "cta",
};

function slideRole(layoutRole: string | undefined, index: number, total: number) {
  if (layoutRole === "cover" || (index === 0 && !layoutRole)) return "cover" as const;
  if (layoutRole === "cta") return "cta" as const;
  if (index === total - 1 && !layoutRole) return "closing" as const;
  return "content" as const;
}

/** The carousel as the guard reads it: slots with the template's limits and the library's images. */
export function toGuardContent(input: {
  document: CarouselDocument;
  manifest: TemplateManifest | null;
  channel: ContentChannel;
  formatKey?: string | null;
  assets: ReadonlyMap<string, GuardAssetInfo>;
  product?: ProductSummary | null;
  asksPrice?: boolean;
}): GuardContentInput {
  const { document: doc, manifest } = input;
  const format = manifest ? FORMATS[manifest.format] : undefined;
  const size = {
    width: manifest?.width ?? format?.width ?? 1080,
    height: manifest?.height ?? format?.height ?? 1350,
  };
  const total = doc.slides.length;
  const slides = doc.slides.slice(0, 30).map((s, index) => {
    const layout = manifest ? findLayout(manifest, s.layout) : undefined;
    const slots: GuardSlotInput[] = [];
    for (const def of layout?.slots ?? []) {
      const value = s.slots[def.name];
      const label = def.label ?? def.name;
      if (def.type === "text") {
        const role = TEXT_ROLES[def.name.toLowerCase()];
        slots.push({
          kind: "text",
          name: def.name,
          label,
          ...(role ? { role } : {}),
          text: typeof value === "string" ? value.slice(0, 5000) : "",
          maxChars: def.maxChars,
          ...(def.maxLines ? { maxLines: def.maxLines } : {}),
        });
      } else if (def.type === "list") {
        slots.push({
          kind: "list",
          name: def.name,
          label,
          items: Array.isArray(value) ? value.slice(0, 50) : [],
          maxItems: def.maxItems,
          maxCharsPerItem: def.maxChars,
        });
      } else {
        const key = value && typeof value === "object" && !Array.isArray(value) ? value.key : null;
        const info = key ? input.assets.get(key) : undefined;
        slots.push({
          kind: "image",
          name: def.name,
          label,
          ...(info
            ? {
                asset: {
                  id: info.id,
                  origin: info.source,
                  ...(info.source === "ai" ? { approval: info.status } : {}),
                  width: info.width ?? 0,
                  height: info.height ?? 0,
                },
              }
            : {}),
        });
      }
    }
    return {
      layout: s.layout,
      role: slideRole(s.role ?? layout?.role, index, total),
      slots,
    };
  });
  const p = input.product;
  return {
    channel: input.channel,
    ...(input.formatKey ? { formatKey: input.formatKey.slice(0, 41) } : {}),
    size,
    slides,
    ...(doc.caption ? { caption: doc.caption } : {}),
    ...(doc.hashtags.length ? { hashtags: doc.hashtags.slice(0, 60) } : {}),
    ...(p
      ? {
          product: {
            name: p.name.slice(0, 300),
            facts: [p.description, ...p.highlights].filter(Boolean).slice(0, 200),
            ...(p.price ? { price: p.price.slice(0, 100) } : {}),
          },
        }
      : {}),
    brief: { asksPrice: Boolean(input.asksPrice) },
  };
}

/** Open findings that need “Seen” before approval (errors and warnings, not notes). */
export function findingsToAcknowledge(report: GuardReport | null | undefined): GuardFinding[] {
  return (report?.findings ?? []).filter(
    (f) => f.status === "open" && (f.severity === "error" || f.severity === "warning"),
  );
}
