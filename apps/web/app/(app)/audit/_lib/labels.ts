import {
  agentRoles,
  channelMetrics,
  type AgentRole,
  type AuditStatus,
  type ChannelMetric,
  type ComparisonOutcome,
  type FindingStatus,
  type ReportStatus,
  type SourceStatus,
} from "@forgecy/core";

// Text labels live in packages/i18n/messages/<locale>/audit.json (t(`audit.status.${s}`)...);
// this module keeps the visual variants and the ids that have a message key.

type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info" | "highlight";

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

export const sourceStatusVariant: Record<SourceStatus, BadgeVariant> = {
  pending: "neutral",
  collecting: "info",
  collected: "success",
  partial: "warning",
  unavailable: "neutral",
  skipped: "neutral",
  failed: "error",
};

export const findingStatusVariant: Record<FindingStatus, BadgeVariant> = {
  observed: "highlight",
  accepted: "success",
  edited: "success",
  rejected: "neutral",
};

export const outcomeVariant: Record<ComparisonOutcome, BadgeVariant> = {
  consistent: "success",
  partial: "warning",
  to_align: "error",
  opportunity: "info",
};

export const reportStatusVariant: Record<ReportStatus, BadgeVariant> = {
  draft: "neutral",
  in_review: "info",
  approved: "success",
  exported: "success",
  superseded: "neutral",
};

const jobKinds = [
  "crawl",
  "analyze_site",
  "analyze_social",
  "propose_competitors",
  "compare_competitors",
  "compare_channels",
  "diagnose",
  "plan",
  "report_texts",
  "report_export",
] as const;
export type AuditJobLabel = (typeof jobKinds)[number];

/** Message id of an audit job kind ("audit.crawl" → "crawl"), null for unknown kinds. */
export function jobLabelId(kind: string): AuditJobLabel | null {
  const id = kind.replace(/^audit\./, "");
  return (jobKinds as readonly string[]).includes(id) ? (id as AuditJobLabel) : null;
}

export function agentLabelId(role: string): AgentRole | null {
  return (agentRoles as readonly string[]).includes(role) ? (role as AgentRole) : null;
}

const scanSteps = [
  "robots",
  "discovery",
  "screenshots",
  "extraction",
  "checks",
  "analysis",
] as const;
export type ScanStepLabel = (typeof scanSteps)[number];

export function stepLabelId(key: string): ScanStepLabel | null {
  return (scanSteps as readonly string[]).includes(key) ? (key as ScanStepLabel) : null;
}

export function metricLabelId(metric: string): ChannelMetric | null {
  return (channelMetrics as readonly string[]).includes(metric) ? (metric as ChannelMetric) : null;
}
