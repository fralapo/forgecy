import type { MessageKey } from "@forgecy/i18n";

// The labels of these values live in packages/i18n/messages/<locale>/brand.json
// (versionStatus, proposalStatus, confidence, sourceKind, sourceStatus, agentRole):
// here only their badge variants.

export const versionStatusVariant = {
  draft: "neutral",
  in_review: "warning",
  approved: "info",
  published: "success",
  archived: "neutral",
} as const;

export const confidenceVariant = { high: "success", medium: "warning", low: "error" } as const;

export const sourceStatusVariant = {
  pending: "neutral",
  extracting: "info",
  extracted: "success",
  partial: "warning",
  failed: "error",
} as const;

/** Readable text for a proposed or current value (strings, objects, lists, DTCG colors). */
export function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$value" in o) return formatValue(o.$value);
    if ("hex" in o && typeof o.hex === "string") return o.hex;
    if ("value" in o && "sourceIds" in o) return formatValue(o.value);
    return Object.entries(o)
      .filter(([k, x]) => x !== undefined && x !== "" && !k.startsWith("$") && k !== "id")
      .map(([k, x]) => `${k}: ${formatValue(x)}`)
      .join(" · ");
  }
  return String(v);
}

export const brandPath = (slug: string, sub = "") => `/brand/${slug}${sub ? `/${sub}` : ""}`;

/**
 * Message key of the field a JSON Pointer belongs to (`brand.fields.strategy.oneLiner`),
 * from the field's own pointer as defined in @forgecy/brand (fields.ts).
 */
export const fieldMessageKey = (fieldPointer: string) =>
  `brand.fields.${fieldPointer.split("/").filter(Boolean).slice(1).join(".")}` as MessageKey;
