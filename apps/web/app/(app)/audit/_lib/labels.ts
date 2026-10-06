import type {
  AuditChannel,
  AuditStatus,
  ComparisonOutcome,
  FindingArea,
  FindingStatus,
  Level,
  ReportStatus,
  SourceStatus,
} from "@forgecy/core";

type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info" | "highlight";

export const auditStatusLabel: Record<AuditStatus, string> = {
  draft: "Draft",
  collecting: "Collecting data",
  awaiting_competitors: "Competitors to confirm",
  analyzing: "Analysis in progress",
  in_review: "To review",
  reviewed: "Reviewed",
  delivered: "Delivered",
  failed: "Error",
  archived: "Archived",
};

export const auditStatusVariant: Record<AuditStatus, BadgeVariant> = {
  draft: "neutral",
  collecting: "info",
  awaiting_competitors: "warning",
  analyzing: "info",
  in_review: "warning",
  reviewed: "success",
  delivered: "success",
  failed: "error",
  archived: "neutral",
};

export const sourceStatusLabel: Record<SourceStatus, string> = {
  pending: "To collect",
  collecting: "Collecting",
  collected: "Collected",
  partial: "Partial",
  unavailable: "Unavailable",
  skipped: "Skipped",
  failed: "Error",
};

export const sourceStatusVariant: Record<SourceStatus, BadgeVariant> = {
  pending: "neutral",
  collecting: "info",
  collected: "success",
  partial: "warning",
  unavailable: "neutral",
  skipped: "neutral",
  failed: "error",
};

export const channelLabel: Record<AuditChannel, string> = {
  website: "Website",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

export const areaLabel: Record<FindingArea, string> = {
  message: "Message and positioning",
  visual: "Visual identity",
  ux: "Experience and conversion",
  seo_accessibility: "SEO and accessibility",
  social_visual: "Visual style",
  social_tone: "Tone of voice",
  social_cta: "Call to action",
  social_formats: "Formats and frequency",
  linkedin_leads: "LinkedIn and leads",
  competitors: "Competitors",
  cross_channel: "Across channels",
};

export const findingStatusLabel: Record<FindingStatus, string> = {
  observed: "To review",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

export const findingStatusVariant: Record<FindingStatus, BadgeVariant> = {
  observed: "highlight",
  accepted: "success",
  edited: "success",
  rejected: "neutral",
};

export const levelLabel: Record<Level, string> = { high: "High", medium: "Medium", low: "Low" };

export const outcomeLabel: Record<ComparisonOutcome, string> = {
  consistent: "Consistent",
  partial: "Partly consistent",
  to_align: "To align",
  opportunity: "Opportunity",
};

export const outcomeVariant: Record<ComparisonOutcome, BadgeVariant> = {
  consistent: "success",
  partial: "warning",
  to_align: "error",
  opportunity: "info",
};

export const agentLabel: Record<string, string> = {
  brand_analyst: "Brand Analyst",
  strategist: "Strategist",
  copywriter: "Copywriter",
};

export const jobLabel: Record<string, string> = {
  "audit.crawl": "Website reading",
  "audit.analyze_site": "Website findings",
  "audit.analyze_social": "Social findings",
  "audit.propose_competitors": "Competitor proposal",
  "audit.compare_competitors": "Comparison with competitors",
  "audit.compare_channels": "Comparison across channels",
  "audit.diagnose": "Diagnosis",
  "audit.plan": "30-day plan",
  "audit.report_texts": "Report texts",
  "audit.report_export": "Report PDF",
};

export const stepLabel: Record<string, string> = {
  robots: "robots.txt",
  discovery: "Page selection",
  screenshots: "Desktop and mobile screenshots",
  extraction: "Texts, colors, fonts and CTAs",
  checks: "Technical checks",
  analysis: "AI findings",
};

export const metricLabel: Record<string, string> = {
  followers: "Followers",
  posts_total: "Total posts",
  followers_gained: "Followers gained",
  followers_lost: "Followers lost",
  impressions: "Impressions",
  clicks: "Clicks",
  ctr: "CTR (%)",
  reactions: "Reactions",
  comments: "Comments",
  shares: "Shares",
  page_visits: "Page visits",
  leads: "Declared leads",
  avg_views: "Average views",
  avg_likes: "Average likes",
};

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export const reportStatusLabel: Record<ReportStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  exported: "Exported",
  superseded: "Superseded",
};

export const reportStatusVariant: Record<ReportStatus, BadgeVariant> = {
  draft: "neutral",
  in_review: "info",
  approved: "success",
  exported: "success",
  superseded: "neutral",
};
