/**
 * Content Strategy and carousels (M5, spec pages 31–48). Typed shapes of the jsonb
 * columns live in @forgecy/content; here they stay generic so the db package doesn't
 * depend on it. Product ids point at the catalog (packages/catalog) without a foreign
 * key, so this module works with or without the catalog installed.
 */
import {
  approvalDecisions,
  assetSources,
  assetStatuses,
  contentObjectives,
  contentPlanStatuses,
  contentVersionOrigins,
  funnelStages,
  strategyItemStatuses,
  type MessageRef,
} from "@forgecy/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { brandIdentityVersions } from "./brand";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";
import { contentStatusEnum, proposalStatusEnum } from "./enums";

type Json = Record<string, unknown>;

export const contentObjectiveEnum = pgEnum("content_objective", contentObjectives);
export const funnelStageEnum = pgEnum("funnel_stage", funnelStages);
export const strategyItemStatusEnum = pgEnum("strategy_item_status", strategyItemStatuses);
export const contentPlanStatusEnum = pgEnum("content_plan_status", contentPlanStatuses);
export const contentVersionOriginEnum = pgEnum("content_version_origin", contentVersionOrigins);
export const assetStatusEnum = pgEnum("asset_status", assetStatuses);
export const assetSourceEnum = pgEnum("asset_source", assetSources);
export const approvalDecisionEnum = pgEnum("approval_decision", approvalDecisions);

/** Columns every strategy item shares: lifecycle, provenance of a proposal, who decided. */
const strategyCommon = () => ({
  status: strategyItemStatusEnum("status").notNull().default("accepted"),
  /** Optimistic concurrency for autosave (draft_rev). */
  rev: integer("rev").notNull().default(1),
  /** Approved product ids from the catalog. */
  productIds: uuid("product_ids")
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  /** Planner proposals: agent, run, model, rationale, sources, confidence. */
  provenance: jsonb("provenance").$type<Json>(),
  brandVersionId: uuid("brand_version_id").references(() => brandIdentityVersions.id, {
    onDelete: "set null",
  }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contentPillars = pgTable(
  "content_pillars",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** A proposal that would change an existing pillar points at it. */
    targetId: uuid("target_id").references((): AnyPgColumn => contentPillars.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    /** Audience segment ids of the published Brand Identity. */
    audienceIds: text("audience_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    funnel: funnelStageEnum("funnel"),
    themes: text("themes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    frequencyCount: integer("frequency_count"),
    frequencyUnit: text("frequency_unit", { enum: ["week", "month"] }),
    cta: text("cta"),
    emotion: text("emotion"),
    examples: jsonb("examples").$type<Json[]>().notNull().default([]),
    forbidden: text("forbidden")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...strategyCommon(),
  },
  (t) => [index("content_pillars_client_idx").on(t.clientId, t.status)],
);

export const contentRubrics = pgTable(
  "content_rubrics",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").references((): AnyPgColumn => contentRubrics.id, {
      onDelete: "cascade",
    }),
    pillarId: uuid("pillar_id")
      .notNull()
      .references(() => contentPillars.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequencyCount: integer("frequency_count"),
    frequencyUnit: text("frequency_unit", { enum: ["week", "month"] }),
    /** Ordered steps: [{ name, role }], role = slide role of the template. */
    structure: jsonb("structure").$type<Json[]>().notNull().default([]),
    hookFormula: text("hook_formula"),
    hookExample: text("hook_example"),
    cta: text("cta"),
    /** Template key in the catalog (`templates.key`). */
    templateKey: text("template_key"),
    channels: text("channels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    ...strategyCommon(),
  },
  (t) => [
    index("content_rubrics_client_idx").on(t.clientId, t.status),
    index("content_rubrics_pillar_idx").on(t.pillarId),
  ],
);

/** The 30-day plan. One `active` plan per client; a new Planner plan stays `proposed`. */
export const contentPlans = pgTable(
  "content_plans",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: contentPlanStatusEnum("status").notNull().default("proposed"),
    provenance: jsonb("provenance").$type<Json>(),
    brandVersionId: uuid("brand_version_id").references(() => brandIdentityVersions.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("content_plans_number_uq").on(t.clientId, t.number),
    uniqueIndex("content_plans_active_uq")
      .on(t.clientId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const contentPlanItems = pgTable(
  "content_plan_items",
  {
    id: id(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => contentPlans.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    day: integer("day").notNull(),
    channel: text("channel").notNull(),
    format: text("format").notNull(),
    pillarId: uuid("pillar_id").references(() => contentPillars.id, { onDelete: "set null" }),
    rubricId: uuid("rubric_id").references(() => contentRubrics.id, { onDelete: "set null" }),
    theme: text("theme").notNull(),
    hook: text("hook"),
    notes: text("notes"),
    /** The carousel created from this item ("Generate carousel"). */
    contentId: uuid("content_id").references((): AnyPgColumn => contents.id, {
      onDelete: "set null",
    }),
    ...strategyCommon(),
  },
  (t) => [
    index("content_plan_items_plan_idx").on(t.planId, t.day),
    index("content_plan_items_client_idx").on(t.clientId),
    check("content_plan_items_day", sql`${t.day} between 1 and 30`),
  ],
);

/**
 * A content (MVP: carousel). The draft document is edited in place with `draftRev`
 * for conflicts; important saves create immutable rows in content_versions.
 */
export const contents = pgTable(
  "contents",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["carousel"] })
      .notNull()
      .default("carousel"),
    title: text("title").notNull(),
    status: contentStatusEnum("status").notNull().default("draft"),
    objective: contentObjectiveEnum("objective").notNull(),
    audienceIds: text("audience_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    pillarId: uuid("pillar_id").references(() => contentPillars.id, { onDelete: "set null" }),
    rubricId: uuid("rubric_id").references(() => contentRubrics.id, { onDelete: "set null" }),
    planItemId: uuid("plan_item_id").references((): AnyPgColumn => contentPlanItems.id, {
      onDelete: "set null",
    }),
    productId: uuid("product_id"),
    /** Product revision the copy was written from ("The product has changed"). */
    productRevision: integer("product_revision"),
    channel: text("channel").notNull(),
    format: text("format").notNull(),
    templateKey: text("template_key").notNull(),
    /** Pinned when the slides are generated; null = newest published version. */
    templateVersion: text("template_version"),
    slideCount: integer("slide_count").notNull().default(7),
    language: text("language").notNull().default("en"),
    brandVersionId: uuid("brand_version_id").references(() => brandIdentityVersions.id, {
      onDelete: "set null",
    }),
    /** Structured brief (problem, promise, tone, constraints, CTA, outputs...). */
    brief: jsonb("brief").$type<Json>().notNull().default({}),
    briefRev: integer("brief_rev").notNull().default(1),
    /** Current outline (title, hook, rows, CTA, caption); history in content_outlines. */
    outline: jsonb("outline").$type<Json>(),
    outlineNumber: integer("outline_number").notNull().default(0),
    outlineBriefRev: integer("outline_brief_rev"),
    outlineApprovedBy: uuid("outline_approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    outlineApprovedAt: timestamp("outline_approved_at", { withTimezone: true }),
    /** Working copy of the carousel document (slides, caption, hashtags). */
    draft: jsonb("draft").$type<Json>(),
    draftRev: integer("draft_rev").notNull().default(1),
    draftUpdatedBy: uuid("draft_updated_by").references(() => users.id, { onDelete: "set null" }),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => contentVersions.id, {
      onDelete: "set null",
    }),
    approvedVersionId: uuid("approved_version_id").references(
      (): AnyPgColumn => contentVersions.id,
      { onDelete: "set null" },
    ),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewNote: text("review_note"),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    lockedByJobId: uuid("locked_by_job_id").references(() => jobs.id, { onDelete: "set null" }),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contents_client_idx").on(t.clientId, t.status),
    index("contents_plan_item_idx").on(t.planItemId),
    index("contents_product_idx").on(t.productId),
    check("contents_slide_count", sql`${t.slideCount} between 1 and 20`),
  ],
);

/** Immutable snapshot of a carousel document. */
export const contentVersions = pgTable(
  "content_versions",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references((): AnyPgColumn => contents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    document: jsonb("document").$type<Json>().notNull(),
    caption: text("caption").notNull().default(""),
    hashtags: text("hashtags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdFrom: contentVersionOriginEnum("created_from").notNull(),
    /** Template, brand version and models the version was made with. */
    meta: jsonb("meta").$type<Json>().notNull().default({}),
    brandVersionId: uuid("brand_version_id").references(() => brandIdentityVersions.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_versions_number_uq").on(t.contentId, t.number)],
);

/** Every outline the Copywriter or a person produced, restorable (page 42). */
export const contentOutlines = pgTable(
  "content_outlines",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    outline: jsonb("outline").$type<Json>().notNull(),
    origin: text("origin", { enum: ["ai", "manual", "restore"] }).notNull(),
    instruction: text("instruction"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_outlines_number_uq").on(t.contentId, t.number)],
);

/**
 * Creative direction of a carousel (v1, Creative Director AI): a proposal a person
 * accepts or rejects. The accepted one guides the Copywriter and the Art Director;
 * a newer proposal makes the older open ones `stale`.
 */
export const contentCreativeDirections = pgTable(
  "content_creative_directions",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: proposalStatusEnum("status").notNull().default("proposed"),
    /** Concept, thread, per-slide intent and visual notes (typed in @forgecy/content). */
    direction: jsonb("direction").$type<Json>().notNull(),
    /** Agent, run, model, rationale. */
    provenance: jsonb("provenance").$type<Json>(),
    instruction: text("instruction"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("content_creative_directions_number_uq").on(t.contentId, t.number),
    check(
      "content_creative_directions_decided_by_person",
      sql`${t.status} not in ('accepted', 'rejected') or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
  ],
);

/** AI instructions on a single slide, with the slide before and after for "Undo change". */
export const contentSlideEdits = pgTable(
  "content_slide_edits",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    slideId: text("slide_id").notNull(),
    instruction: text("instruction").notNull(),
    status: text("status", { enum: ["queued", "applied", "kept", "reverted", "failed"] })
      .notNull()
      .default("queued"),
    before: jsonb("before").$type<Json>(),
    after: jsonb("after").$type<Json>(),
    note: text("note"),
    /** `note` as a message reference when written by code (a failure). */
    noteRef: jsonb("note_ref").$type<MessageRef>(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    model: text("model"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_slide_edits_content_idx").on(t.contentId, t.slideId)],
);

export const contentComments = pgTable(
  "content_comments",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => contentVersions.id, { onDelete: "set null" }),
    slideId: text("slide_id"),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("content_comments_content_idx").on(t.contentId)],
);

/** Human decisions on a version (spec: approvals). An agent is never the author. */
export const contentApprovals = pgTable(
  "content_approvals",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => contentVersions.id, { onDelete: "cascade" }),
    decision: approvalDecisionEnum("decision").notNull(),
    note: text("note"),
    selfApproval: boolean("self_approval").notNull().default(false),
    /** Check ids the reviewer confirmed with “I’ve seen it”. */
    acknowledged: jsonb("acknowledged").$type<string[]>().notNull().default([]),
    decidedBy: uuid("decided_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_approvals_content_idx").on(t.contentId)],
);

/** Export runs; files and sizes come from the export job result. */
export const contentExports = pgTable(
  "content_exports",
  {
    id: id(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => contents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => contentVersions.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    draft: boolean("draft").notNull(),
    outputs: text("outputs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    files: jsonb("files").$type<Json[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("content_exports_content_idx").on(t.contentId)],
);

/**
 * Client asset library (images for slides). AI images record their generation
 * (visual brief, prompt, provider, model, cost) and stay drafts until approved.
 */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["image"] })
      .notNull()
      .default("image"),
    source: assetSourceEnum("source").notNull(),
    status: assetStatusEnum("status").notNull().default("draft"),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt").notNull().default(""),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    generation: jsonb("generation").$type<Json>(),
    productId: uuid("product_id"),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("assets_client_sha_uq").on(t.clientId, t.sha256),
    index("assets_client_status_idx").on(t.clientId, t.status),
    check("assets_ai_has_generation", sql`${t.source} <> 'ai' or ${t.generation} is not null`),
  ],
);
