import {
  auditChannels,
  auditStatuses,
  competitorStatuses,
  findingAreas,
  findingKinds,
  findingStatuses,
  levels,
  metricSources,
  reportStatuses,
  reportVariants,
  sourceStatuses,
  type AuditEvidence,
  type ComparisonChannel,
  type ComparisonCriterion,
  type ComparisonOutcome,
  type MessageRef,
  type ReportSection,
  type SocialChannel,
} from "@forgecy/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";

// Prospect audit (M2). Enum values come from @forgecy/core (audit.ts).
export const auditStatusEnum = pgEnum("audit_status", auditStatuses);
export const sourceStatusEnum = pgEnum("audit_source_status", sourceStatuses);
export const auditChannelEnum = pgEnum("audit_channel", auditChannels);
export const findingKindEnum = pgEnum("audit_finding_kind", findingKinds);
export const findingStatusEnum = pgEnum("audit_finding_status", findingStatuses);
export const findingAreaEnum = pgEnum("audit_finding_area", findingAreas);
export const levelEnum = pgEnum("audit_level", levels);
export const competitorStatusEnum = pgEnum("audit_competitor_status", competitorStatuses);
export const metricSourceEnum = pgEnum("audit_metric_source", metricSources);
export const reportStatusEnum = pgEnum("audit_report_status", reportStatuses);
export const reportVariantEnum = pgEnum("audit_report_variant", reportVariants);

/** Prospect data the audit needs beyond `clients`: area, objectives, owner, social profiles. */
export const prospectProfiles = pgTable("prospect_profiles", {
  clientId: uuid("client_id")
    .primaryKey()
    .references(() => clients.id, { onDelete: "cascade" }),
  area: text("area"),
  objectives: jsonb("objectives").$type<string[]>().notNull().default([]),
  otherObjective: text("other_objective"),
  reportLanguage: text("report_language").notNull().default("en"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  socialUrls: jsonb("social_urls")
    .$type<Partial<Record<SocialChannel, string>>>()
    .notNull()
    .default({}),
  /** Optimistic concurrency for inline edits (draft_rev). */
  rev: integer("rev").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Snapshot of what the audit started from: changing the prospect later never rewrites it. */
export interface AuditInputs {
  websiteUrl?: string;
  sector?: string;
  area?: string;
  objectives?: string[];
  otherObjective?: string;
  notes?: string;
  reportLanguage?: string;
  socialUrls?: Partial<Record<SocialChannel, string>>;
}

export const audits = pgTable(
  "audits",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: auditStatusEnum("status").notNull().default("draft"),
    inputs: jsonb("inputs").$type<AuditInputs>().notNull().default({}),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    competitorsConfirmedBy: uuid("competitors_confirmed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    competitorsConfirmedAt: timestamp("competitors_confirmed_at", { withTimezone: true }),
    /** "Continue without competitors": the report has no competitor section. */
    competitorsSkipped: boolean("competitors_skipped").notNull().default(false),
    diagnosisAt: timestamp("diagnosis_at", { withTimezone: true }),
    /** Last accept/edit/reject of an observation: drives the "Update diagnosis" banner. */
    findingsChangedAt: timestamp("findings_changed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("audits_client_idx").on(t.clientId),
    index("audits_status_idx").on(t.status),
    // One audit at a time per prospect until it is delivered or archived.
    uniqueIndex("audits_one_active_uq")
      .on(t.clientId)
      .where(sql`${t.status} not in ('delivered', 'archived')`),
  ],
);

export interface ScanStep {
  key: "robots" | "discovery" | "screenshots" | "extraction" | "checks" | "analysis";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  detail?: string;
  /** `detail` as a message reference, shown in the user's language. */
  detailRef?: MessageRef;
  startedAt?: string;
  endedAt?: string;
}

/** Observed, not interpreted: what the crawler measured across the pages it read. */
export interface ScanExtraction {
  colors?: Array<{ hex: string; share: number }>;
  fonts?: Array<{ family: string; usage: "headings" | "body" | "both"; share: number }>;
  ctas?: Array<{ text: string; pages: string[] }>;
  socialLinks?: Array<{ channel: string; url: string }>;
  contactForm?: boolean;
  /** Accessibility and performance checks computed without AI. */
  checks?: Array<{
    key: string;
    label: string;
    ok: boolean;
    detail: string;
    /** `detail` as a message reference, shown in the user's language. */
    detailRef?: MessageRef;
    pages: string[];
  }>;
  /** Competitor benchmark (written by the Brand Analyst, quote verified on the pages). */
  offer?: string;
  tone?: string;
  toneQuote?: string;
}

/**
 * One reading of a site (prospect or competitor). Brand Scanner (M4) can reuse these
 * rows for clients without an audit, so the same site is not read twice.
 */
export const siteScans = pgTable(
  "site_scans",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    auditId: uuid("audit_id").references(() => audits.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references((): AnyPgColumn => auditCompetitors.id, {
      onDelete: "cascade",
    }),
    rootUrl: text("root_url").notNull(),
    status: sourceStatusEnum("status").notNull().default("pending"),
    maxPages: integer("max_pages").notNull(),
    steps: jsonb("steps").$type<ScanStep[]>().notNull().default([]),
    robots: jsonb("robots").$type<{
      found: boolean;
      blockedAll: boolean;
      /** AI answer-engine crawlers that robots.txt keeps off the home page. */
      aiCrawlersBlocked?: string[];
    }>(),
    extracted: jsonb("extracted").$type<ScanExtraction>(),
    /** Stable error code shown in the UI (SOURCE-UNAVAILABLE, AUD-ROBOTS-BLOCKED...). */
    errorCode: text("error_code"),
    error: text("error"),
    /** `error` as a message reference, shown in the reader's language. */
    errorRef: jsonb("error_ref").$type<MessageRef>(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("site_scans_audit_idx").on(t.auditId),
    index("site_scans_client_idx").on(t.clientId),
    index("site_scans_competitor_idx").on(t.competitorId),
  ],
);

/** Data read from one page by the crawler. */
export interface PageData {
  httpStatus?: number;
  metaDescription?: string;
  h1?: string[];
  headings?: Array<{ level: number; text: string }>;
  ctas?: string[];
  textExcerpt?: string;
  lang?: string;
  hasViewport?: boolean;
  imagesWithoutAlt?: number;
  imagesTotal?: number;
  contactForm?: boolean;
  /** schema.org types declared in JSON-LD blocks. */
  structuredDataTypes?: string[];
  loadMs?: number;
  links?: number;
}

/** Info about an uploaded CSV/XLSX file. */
export interface FileData {
  sheet?: string;
  headers?: string[];
  mapping?: Record<string, string>;
  dateFormat?: string;
  rowsImported?: number;
  rowsSkipped?: number;
}

/** A page, a screenshot, an imported file or a manual entry the audit relies on. */
export const auditSources = pgTable(
  "audit_sources",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    scanId: uuid("scan_id").references(() => siteScans.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id").references((): AnyPgColumn => auditCompetitors.id, {
      onDelete: "cascade",
    }),
    channel: auditChannelEnum("channel").notNull(),
    kind: text("kind", { enum: ["page", "screenshot", "file", "manual"] }).notNull(),
    method: text("method", {
      enum: ["public_page", "screenshot", "manual_import", "manual", "ai_inference"],
    }).notNull(),
    providedBy: text("provided_by", { enum: ["crawl", "upload", "manual"] }).notNull(),
    status: sourceStatusEnum("status").notNull().default("collected"),
    url: text("url"),
    title: text("title"),
    /** Desktop screenshot (pages) or the uploaded file. */
    storageKey: text("storage_key"),
    storageKeyMobile: text("storage_key_mobile"),
    fileName: text("file_name"),
    mime: text("mime"),
    size: integer("size"),
    sha256: text("sha256"),
    data: jsonb("data").$type<PageData & FileData>().notNull().default({}),
    /** Why a page was not read: robots.txt, login, timeout, HTTP error. */
    skipReason: text("skip_reason"),
    skipRef: jsonb("skip_ref").$type<MessageRef>(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_sources_audit_idx").on(t.auditId, t.channel),
    index("audit_sources_scan_idx").on(t.scanId),
  ],
);

/** Social channels of an audit and the state of their data (no automatic reading, ever). */
export const auditChannelStates = pgTable(
  "audit_channels",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    channel: auditChannelEnum("channel").notNull(),
    profileUrl: text("profile_url"),
    status: sourceStatusEnum("status").notNull().default("pending"),
    unavailableReason: text("unavailable_reason"),
    /** Null when a person typed the reason. */
    unavailableRef: jsonb("unavailable_ref").$type<MessageRef>(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("audit_channels_uq").on(t.auditId, t.channel)],
);

/** A channel metric with its source and date. Never estimated: a missing value has no row. */
export const auditMetrics = pgTable(
  "audit_metrics",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    channel: auditChannelEnum("channel").notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
    observedOn: date("observed_on").notNull(),
    source: metricSourceEnum("source").notNull(),
    sourceNote: text("source_note"),
    sourceId: uuid("source_id").references(() => auditSources.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("audit_metrics_audit_idx").on(t.auditId, t.channel)],
);

/** One post from an imported CSV/XLSX export. */
export const auditSocialPosts = pgTable(
  "audit_social_posts",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    channel: auditChannelEnum("channel").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => auditSources.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    postedOn: date("posted_on").notNull(),
    postType: text("post_type"),
    format: text("format"),
    text: text("text"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_social_posts_audit_idx").on(t.auditId, t.channel, t.postedOn)],
);

/** Competitors proposed by the Strategist or added by a person; a person always confirms. */
export const auditCompetitors = pgTable(
  "audit_competitors",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    reason: text("reason"),
    confidence: levelEnum("confidence").notNull().default("low"),
    /** Agent role that proposed it ("strategist"), null when a person added it. */
    proposedByAgent: text("proposed_by_agent"),
    status: competitorStatusEnum("status").notNull().default("proposed"),
    removedReason: text("removed_reason"),
    removedRef: jsonb("removed_ref").$type<MessageRef>(),
    sourceStatus: sourceStatusEnum("source_status").notNull().default("pending"),
    sourceError: text("source_error"),
    sourceErrorRef: jsonb("source_error_ref").$type<MessageRef>(),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audit_competitors_audit_idx").on(t.auditId)],
);

/** Cells of a cross-channel comparison row (Page 10). */
export interface ComparisonData {
  criterion: ComparisonCriterion;
  cells: Partial<
    Record<
      ComparisonChannel,
      { value: string | null; unavailableReason?: string; evidence?: AuditEvidence[] }
    >
  >;
  outcome: ComparisonOutcome;
  /** Outcome the agent proposed, kept to require a note when a person changes it. */
  proposedOutcome?: ComparisonOutcome;
  rationale: string;
  outcomeNote?: string;
}

/** Which model wrote an AI finding, for the AIOutputCard. */
export interface AiMeta {
  provider?: string;
  model?: string;
  policy?: string;
  jobId?: string;
  at?: string;
}

/**
 * Observations, diagnosis problems and comparison rows. Agents create them as
 * `observed`; only a person accepts, edits or rejects.
 */
export const auditFindings = pgTable(
  "audit_findings",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    kind: findingKindEnum("kind").notNull(),
    area: findingAreaEnum("area").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    impact: text("impact"),
    recommendation: text("recommendation"),
    priority: levelEnum("priority").notNull().default("medium"),
    suggestedPriority: levelEnum("suggested_priority"),
    confidence: levelEnum("confidence").notNull().default("low"),
    confidenceReason: text("confidence_reason"),
    confidenceRef: jsonb("confidence_ref").$type<MessageRef>(),
    status: findingStatusEnum("status").notNull().default("observed"),
    evidence: jsonb("evidence").$type<AuditEvidence[]>().notNull().default([]),
    /** Problems: the observations they rest on. */
    parentIds: uuid("parent_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    comparison: jsonb("comparison").$type<ComparisonData>(),
    competitorId: uuid("competitor_id").references(() => auditCompetitors.id, {
      onDelete: "cascade",
    }),
    /** Reading the observation came from ("From previous reading" after a new scan). */
    scanId: uuid("scan_id").references(() => siteScans.id, { onDelete: "set null" }),
    channel: auditChannelEnum("channel"),
    /** Agent role that proposed it, null for findings written by a person. */
    authorAgent: text("author_agent"),
    aiMeta: jsonb("ai_meta").$type<AiMeta>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    /** True once a person changed the text: regeneration keeps it. */
    editedByHuman: boolean("edited_by_human").notNull().default(false),
    /** Problems whose linked observations changed after a diagnosis update. */
    stale: boolean("stale").notNull().default(false),
    rejectedReason: text("rejected_reason"),
    position: integer("position").notNull().default(0),
    rev: integer("rev").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("audit_findings_audit_idx").on(t.auditId, t.kind, t.status),
    index("audit_findings_competitor_idx").on(t.competitorId),
  ],
);

export interface PlanPillar {
  name: string;
  goal: string;
  /** Problems (finding ids) the pillar answers. */
  problemIds: string[];
}

export interface PlanItem {
  day: number;
  channel: "instagram" | "facebook" | "linkedin" | "tiktok";
  format: string;
  pillar: string;
  topic: string;
  hook: string;
}

/**
 * The 30-day plan proposed with the diagnosis (spec: audit_plan step). It stays a
 * proposal: Content Strategy (M5) turns accepted pillars into its own records.
 */
export const auditPlans = pgTable(
  "audit_plans",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pillars: jsonb("pillars").$type<PlanPillar[]>().notNull().default([]),
    items: jsonb("items").$type<PlanItem[]>().notNull().default([]),
    status: findingStatusEnum("status").notNull().default("observed"),
    authorAgent: text("author_agent"),
    aiMeta: jsonb("ai_meta").$type<AiMeta>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("audit_plans_audit_uq").on(t.auditId)],
);

/**
 * One version of the client-facing audit report (UX Page 12–13). Approved and
 * exported versions never change: a correction is the next version. Only people
 * submit, approve and export; agents propose texts.
 */
export const auditReports = pgTable(
  "audit_reports",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: reportStatusEnum("status").notNull().default("draft"),
    /** Published "report" template row chosen for the PDF (catalog of M3); null until one exists. */
    templateId: uuid("template_id"),
    sections: jsonb("sections").$type<ReportSection[]>().notNull().default([]),
    /** Accepted findings the person left out of this version. */
    excludedFindingIds: uuid("excluded_finding_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    emailSubject: text("email_subject"),
    emailBody: text("email_body"),
    emailByAgent: boolean("email_by_agent").notNull().default(false),
    aiMeta: jsonb("ai_meta").$type<AiMeta>(),
    /** Diagnosis time the texts were written against (stale banner). */
    findingsAt: timestamp("findings_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    submitNote: text("submit_note"),
    changesRequested: text("changes_requested"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    rev: integer("rev").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("audit_reports_version_uq").on(t.auditId, t.version)],
);

/** PDFs produced from a report version; the file stays, only its link expires. */
export const auditReportExports = pgTable(
  "audit_report_exports",
  {
    id: id(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => auditReports.id, { onDelete: "cascade" }),
    variant: reportVariantEnum("variant").notNull(),
    /** false: draft PDF with the "Draft" watermark. */
    final: boolean("final").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    bytes: integer("bytes").notNull(),
    pages: integer("pages").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("audit_report_exports_report_idx").on(t.reportId)],
);
