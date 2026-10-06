/**
 * Prospect audit (spec: "Audit dei potenziali clienti", UX section 12). The values
 * live here so the database enums, the Zod schemas and the UI never drift.
 */

/** draft → collecting → awaiting_competitors → analyzing → in_review → reviewed → delivered. */
export const auditStatuses = [
  "draft",
  "collecting",
  "awaiting_competitors",
  "analyzing",
  "in_review",
  "reviewed",
  "delivered",
  "failed",
  "archived",
] as const;
export type AuditStatus = (typeof auditStatuses)[number];

/** Audits that still block a new one for the same prospect (one active audit at a time). */
export const ACTIVE_AUDIT_STATUSES: readonly AuditStatus[] = [
  "draft",
  "collecting",
  "awaiting_competitors",
  "analyzing",
  "in_review",
  "reviewed",
  "failed",
];

/** State of a data source: the website, a social channel, a competitor, a single page. */
export const sourceStatuses = [
  "pending",
  "collecting",
  "collected",
  "partial",
  "unavailable",
  "skipped",
  "failed",
] as const;
export type SourceStatus = (typeof sourceStatuses)[number];

export const auditChannels = ["website", "instagram", "facebook", "linkedin", "tiktok"] as const;
export type AuditChannel = (typeof auditChannels)[number];
export const socialChannels = ["instagram", "facebook", "linkedin", "tiktok"] as const;
export type SocialChannel = (typeof socialChannels)[number];

/** observation: a fact with evidence; problem: one of the 3–5 diagnosis items; comparison: a cross-channel row. */
export const findingKinds = ["observation", "problem", "comparison"] as const;
export type FindingKind = (typeof findingKinds)[number];

/** Only accepted and edited findings reach diagnosis and report. */
export const findingStatuses = ["observed", "accepted", "edited", "rejected"] as const;
export type FindingStatus = (typeof findingStatuses)[number];
export const USABLE_FINDING_STATUSES: readonly FindingStatus[] = ["accepted", "edited"];

export const findingAreas = [
  // Website
  "message",
  "visual",
  "ux",
  "seo_accessibility",
  // Social
  "social_visual",
  "social_tone",
  "social_cta",
  "social_formats",
  "linkedin_leads",
  // Others
  "competitors",
  "cross_channel",
] as const;
export type FindingArea = (typeof findingAreas)[number];

export const WEBSITE_AREAS: readonly FindingArea[] = [
  "message",
  "visual",
  "ux",
  "seo_accessibility",
];
export const SOCIAL_AREAS: readonly FindingArea[] = [
  "social_visual",
  "social_tone",
  "social_cta",
  "social_formats",
  "linkedin_leads",
];

export const levels = ["high", "medium", "low"] as const;
/** Priority (chosen by a person, suggested by the agent) and confidence (computed from sources). */
export type Level = (typeof levels)[number];

export const competitorStatuses = ["proposed", "confirmed", "removed"] as const;
export type CompetitorStatus = (typeof competitorStatuses)[number];

/** Outcome of a cross-channel criterion (Page 10). */
export const comparisonOutcomes = ["consistent", "partial", "to_align", "opportunity"] as const;
export type ComparisonOutcome = (typeof comparisonOutcomes)[number];
export const comparisonCriteria = ["color", "tone", "cta", "audience", "visual_style"] as const;
export type ComparisonCriterion = (typeof comparisonCriteria)[number];
/** Channels compared in the MVP (UXA-P1-18). */
export const comparisonChannels = ["website", "instagram", "facebook"] as const;
export type ComparisonChannel = (typeof comparisonChannels)[number];

/** Where a manually entered metric comes from; a value without a source is never saved. */
export const metricSources = [
  "provided_by_prospect",
  "agency_tool",
  "public_profile",
  "file_import",
  "other",
] as const;
export type MetricSource = (typeof metricSources)[number];

/** Fields a CSV/XLSX column can map to (Page 8). */
export const socialPostFields = [
  "date",
  "post_type",
  "format",
  "text",
  "views",
  "reach",
  "interactions",
  "likes",
  "comments",
  "saves",
  "shares",
  "followers",
  "impressions",
  "clicks",
  "ctr",
  "followers_gained",
  "followers_lost",
  "page_visits",
  "leads",
] as const;
export type SocialPostField = (typeof socialPostFields)[number];

/** Channel-level metrics entered by hand. */
export const channelMetrics = [
  "followers",
  "posts_total",
  "followers_gained",
  "followers_lost",
  "impressions",
  "clicks",
  "ctr",
  "reactions",
  "comments",
  "shares",
  "page_visits",
  "leads",
  "avg_views",
  "avg_likes",
] as const;
export type ChannelMetric = (typeof channelMetrics)[number];

/** Crawl and review limits (UXA-P1-14, UXA-P1-16, UXA-P1-17, UXA-P1-19). */
export const AUDIT_LIMITS = {
  maxPages: 10,
  maxCompetitorPages: 3,
  maxCompetitors: 5,
  pageTimeoutMs: 30_000,
  crawlTimeoutMs: 10 * 60_000,
  maxScreenshotsPerChannel: 60,
  maxProblems: 5,
  minProblems: 3,
} as const;

/**
 * Confidence from evidence, never from the model: high needs at least three
 * concordant elements, medium two, otherwise low.
 */
export function confidenceFromEvidence(concordantElements: number): Level {
  if (concordantElements >= 3) return "high";
  if (concordantElements === 2) return "medium";
  return "low";
}

/** Proof attached to a finding: a page, a screenshot, a quote, a technical check, a file row. */
export const evidenceTypes = [
  "page",
  "screenshot",
  "quote",
  "technical",
  "file_row",
  "metric",
  "note",
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export interface AuditEvidence {
  type: EvidenceType;
  /** audit_sources row the evidence comes from (page, screenshot, file). */
  sourceId?: string;
  url?: string;
  /** Verbatim text from the source. */
  quote?: string;
  /** Short human label, e.g. "Home · H1". */
  label?: string;
  note?: string;
  /** Channel of the source, for the "Fonte" chips. */
  channel?: AuditChannel;
  /** ISO date the source was captured. */
  capturedAt?: string;
}

/** Prospect objectives (Page 5). "other" needs a short text. */
export const prospectObjectives = [
  "more_leads",
  "brand_awareness",
  "social_growth",
  "new_market",
  "rebranding",
  "online_sales",
  "other",
] as const;
export type ProspectObjective = (typeof prospectObjectives)[number];
export const prospectObjectiveLabels: Record<ProspectObjective, string> = {
  more_leads: "Più contatti e preventivi",
  brand_awareness: "Farsi conoscere",
  social_growth: "Crescere sui social",
  new_market: "Entrare in un nuovo mercato",
  rebranding: "Rinnovare l'immagine",
  online_sales: "Vendere online",
  other: "Altro",
};

// ---------------------------------------------------------------- Report (UX Page 12–13)

/** draft → in_review → approved → exported; a newer approved version supersedes older ones. */
export const reportStatuses = ["draft", "in_review", "approved", "exported", "superseded"] as const;
export type ReportStatus = (typeof reportStatuses)[number];

/** Full report or the compact one for a first email; both come from the same version. */
export const reportVariants = ["full", "compact"] as const;
export type ReportVariant = (typeof reportVariants)[number];

/** Sections in their default order. Cover and method are always in the full report. */
export const reportSectionKeys = [
  "cover",
  "overview",
  "problems",
  "website",
  "social",
  "competitors",
  "cross_channel",
  "opportunities",
  "next_steps",
  "method",
] as const;
export type ReportSectionKey = (typeof reportSectionKeys)[number];
export const FIXED_REPORT_SECTIONS: readonly ReportSectionKey[] = ["cover", "method"];
/** The compact report: overview, main problems, next steps and a one-page method note. */
export const COMPACT_REPORT_SECTIONS: readonly ReportSectionKey[] = [
  "cover",
  "overview",
  "problems",
  "next_steps",
  "method",
];

/** One section of a report version: order, on/off and the text written for it. */
export interface ReportSection {
  key: ReportSectionKey;
  enabled: boolean;
  title: string;
  /** Intro paragraph(s); proposed by the Strategist or written by hand. */
  intro: string;
  /** Bullet points (overview and next steps). */
  bullets: string[];
  /** Set when the text came from an agent and nobody changed it since. */
  byAgent?: boolean;
}
