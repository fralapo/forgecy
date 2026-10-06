import type { BrandSourceKind, BrandSourceStatus, ConfidenceLevel } from "@forgecy/core";

export const versionStatusLabel = {
  draft: "Bozza",
  in_review: "In revisione",
  approved: "Approvata",
  published: "Pubblicata",
  archived: "Archiviata",
} as const;

export const versionStatusVariant = {
  draft: "neutral",
  in_review: "warning",
  approved: "info",
  published: "success",
  archived: "neutral",
} as const;

export const proposalStatusLabel = {
  proposed: "Proposta",
  accepted: "Accettata",
  rejected: "Rifiutata",
  stale: "Superata",
} as const;

export const confidenceLabel: Record<ConfidenceLevel, string> = {
  high: "Confidenza alta",
  medium: "Confidenza media",
  low: "Confidenza bassa",
};

export const confidenceVariant = { high: "success", medium: "warning", low: "error" } as const;

export const sourceKindLabel: Record<BrandSourceKind, string> = {
  brand_book: "Brand book",
  document: "Documento del cliente",
  interview: "Intervista",
  questionnaire: "Questionario",
  client_approval: "Approvazione del cliente",
  manual: "Nota manuale",
  internal_feedback: "Feedback interno",
  website: "Sito web",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  screenshot: "Screenshot",
  audit: "Audit",
  competitor: "Concorrente",
  agent_observation: "Osservazione AI",
};

export const sourceStatusLabel: Record<BrandSourceStatus, string> = {
  pending: "In coda",
  extracting: "In lettura",
  extracted: "Letta",
  partial: "Letta in parte",
  failed: "Non riuscita",
};

export const sourceStatusVariant = {
  pending: "neutral",
  extracting: "info",
  extracted: "success",
  partial: "warning",
  failed: "error",
} as const;

export const agentRoleLabel: Record<string, string> = {
  brand_analyst: "Brand Analyst",
  strategist: "Strategist",
  art_director: "Art Director",
  copywriter: "Copywriter",
  reviewer: "Reviewer",
};

const dateFmt = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });
export const formatDate = (d: Date | string | null | undefined) =>
  d ? dateFmt.format(typeof d === "string" ? new Date(d) : d) : "—";

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
