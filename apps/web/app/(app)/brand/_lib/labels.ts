import type { BrandSourceKind, BrandSourceStatus, ConfidenceLevel } from "@forgecy/core";

export const versionStatusLabel = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
} as const;

export const versionStatusVariant = {
  draft: "neutral",
  in_review: "warning",
  approved: "info",
  published: "success",
  archived: "neutral",
} as const;

export const proposalStatusLabel = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  stale: "Superseded",
} as const;

export const confidenceLabel: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export const confidenceVariant = { high: "success", medium: "warning", low: "error" } as const;

export const sourceKindLabel: Record<BrandSourceKind, string> = {
  brand_book: "Brand book",
  document: "Client document",
  interview: "Interview",
  questionnaire: "Questionnaire",
  client_approval: "Client approval",
  manual: "Manual note",
  internal_feedback: "Internal feedback",
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  screenshot: "Screenshot",
  audit: "Audit",
  competitor: "Competitor",
  agent_observation: "AI observation",
};

export const sourceStatusLabel: Record<BrandSourceStatus, string> = {
  pending: "Queued",
  extracting: "Reading",
  extracted: "Read",
  partial: "Partly read",
  failed: "Failed",
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

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
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
