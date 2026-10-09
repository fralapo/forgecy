/**
 * Brand Identity (M4). One identity per client; its content lives in versions.
 * A version is editable while `draft` or `in_review` and immutable from `approved`
 * on (a trigger in the migration enforces it). Agents never write versions: they
 * create proposals (RFC 6902 JSON Patch with `test` ops) that a person accepts.
 */
import {
  actorTypes,
  brandExampleKinds,
  brandExampleVerdicts,
  brandSourceKinds,
  brandSourceStatuses,
  confidenceLevels,
  type MessageRef,
} from "@forgecy/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt, id, updatedAt } from "./_common";
import { proposalStatusEnum, versionStatusEnum } from "./enums";

export const actorTypeEnum = pgEnum("actor_type", actorTypes);
export const confidenceEnum = pgEnum("confidence_level", confidenceLevels);
export const brandSourceKindEnum = pgEnum("brand_source_kind", brandSourceKinds);
export const brandSourceStatusEnum = pgEnum("brand_source_status", brandSourceStatuses);
export const brandExampleKindEnum = pgEnum("brand_example_kind", brandExampleKinds);
export const brandExampleVerdictEnum = pgEnum("brand_example_verdict", brandExampleVerdicts);

export const brandIdentities = pgTable("brand_identities", {
  id: id(),
  clientId: uuid("client_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const brandIdentityVersions = pgTable(
  "brand_identity_versions",
  {
    id: id(),
    brandIdentityId: uuid("brand_identity_id")
      .notNull()
      .references(() => brandIdentities.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: versionStatusEnum("status").notNull().default("draft"),
    /** BrandIdentityDocument (see @forgecy/brand). */
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    /** DTCG token tree: reference, semantic and component levels. */
    tokens: jsonb("tokens").$type<Record<string, unknown>>().notNull(),
    /** Optimistic concurrency for draft edits (draft_rev in the spec). */
    rev: integer("rev").notNull().default(1),
    changelog: text("changelog"),
    restoredFromVersionId: uuid("restored_from_version_id").references(
      (): AnyPgColumn => brandIdentityVersions.id,
      { onDelete: "set null" },
    ),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastEditedBy: uuid("last_edited_by").references(() => users.id, { onDelete: "set null" }),
    /** People who changed this draft (edits and accepted proposals): approving it is a self-approval. */
    editorIds: jsonb("editor_ids").$type<string[]>().notNull().default([]),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewComment: text("review_comment"),
    /** Approvers and publishers are always people: these reference users, never agents. */
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Open checks the approver confirmed with "I’ve seen it" at publication time. */
    acknowledgedChecks: jsonb("acknowledged_checks").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brand_versions_number_uq").on(t.brandIdentityId, t.number),
    // One published version per client, and one open draft at a time.
    uniqueIndex("brand_versions_one_published_uq")
      .on(t.clientId)
      .where(sql`${t.status} = 'published'`),
    uniqueIndex("brand_versions_one_open_uq")
      .on(t.brandIdentityId)
      .where(sql`${t.status} in ('draft', 'in_review')`),
    index("brand_versions_client_idx").on(t.clientId, t.status),
    check(
      "brand_versions_approved_by_person",
      sql`${t.status} not in ('approved', 'published') or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
    check(
      "brand_versions_published_by_person",
      sql`${t.status} <> 'published' or (${t.publishedBy} is not null and ${t.publishedAt} is not null)`,
    ),
    check("brand_versions_number_positive", sql`${t.number} > 0`),
  ],
);

/** Files, pages and inputs a brand fact can cite (brand book, site, interview...). */
export const brandSources = pgTable(
  "brand_sources",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: brandSourceKindEnum("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    storageKey: text("storage_key"),
    mime: text("mime"),
    size: bigint("size", { mode: "number" }),
    sha256: text("sha256"),
    /** Reference to another module's record, e.g. an audit id. */
    externalRef: text("external_ref"),
    status: brandSourceStatusEnum("status").notNull().default("pending"),
    /** Short summary of the last extraction ("23 elementi estratti"), or the error. */
    statusDetail: text("status_detail"),
    /** `statusDetail` as message references (joined with " · "), shown in the reader's language. */
    statusDetailRef: jsonb("status_detail_ref").$type<MessageRef[]>(),
    /**
     * Extracted pages: [{ locator: "p. 12", text }]. Kept for evidence and re-runs. The
     * locator is a stable English id the AI cites; pages translate it when shown.
     */
    pages: jsonb("pages").$type<Array<{ locator: string; text: string }>>(),
    /** What the browser read on the site (colors, fonts, logos, images): a SiteProbe from @forgecy/audit, typed there. */
    visual: jsonb("visual").$type<Record<string, unknown> | null>(),
    note: text("note"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brand_sources_client_idx").on(t.clientId),
    uniqueIndex("brand_sources_file_uq")
      .on(t.clientId, t.sha256)
      .where(sql`${t.sha256} is not null and ${t.removedAt} is null`),
  ],
);

/**
 * Proposed changes to the open draft. `changes` is an RFC 6902 JSON Patch over
 * `{ document, tokens }`; its `test` ops make the proposal `stale` instead of
 * overwriting a field someone changed meanwhile.
 */
export const brandIdentityProposals = pgTable(
  "brand_identity_proposals",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brandIdentityId: uuid("brand_identity_id")
      .notNull()
      .references(() => brandIdentities.id, { onDelete: "cascade" }),
    authorType: actorTypeEnum("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    agentRole: text("agent_role"),
    /** Job that produced it (agents). */
    runId: uuid("run_id"),
    /** Draft version the patch was computed against. */
    baseVersionId: uuid("base_version_id").references(() => brandIdentityVersions.id, {
      onDelete: "set null",
    }),
    baseRev: integer("base_rev"),
    /** JSON Pointer of the field it changes, e.g. /document/strategy/oneLiner. */
    fieldPath: text("field_path").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    /** `title` as a message reference when written by code. */
    titleRef: jsonb("title_ref").$type<MessageRef>(),
    changes: jsonb("changes").$type<Array<Record<string, unknown>>>().notNull(),
    rationale: text("rationale"),
    /** `rationale` as a message reference when written by code (AI rationale has none). */
    rationaleRef: jsonb("rationale_ref").$type<MessageRef>(),
    /** [{ sourceId, locator?, quote? }] */
    evidence: jsonb("evidence")
      .$type<Array<{ sourceId: string; locator?: string; quote?: string }>>()
      .notNull()
      .default([]),
    confidence: confidenceEnum("confidence").notNull(),
    /** What the model said about itself: informative only, never used to decide. */
    modelConfidence: real("model_confidence"),
    /** Automatic check results (contrast, forbidden words...), not a review. */
    checks: jsonb("checks")
      .$type<Array<{ level: "info" | "warning"; message: string }>>()
      .notNull()
      .default([]),
    sensitive: boolean("sensitive").notNull(),
    status: proposalStatusEnum("status").notNull().default("proposed"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "restrict" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    /** Value actually written when accepted with edits ("Accept with edits"). */
    editedValue: jsonb("edited_value").$type<unknown>(),
    staleReason: text("stale_reason"),
    staleRef: jsonb("stale_ref").$type<MessageRef>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("brand_proposals_client_status_idx").on(t.clientId, t.status),
    index("brand_proposals_field_idx").on(t.brandIdentityId, t.fieldPath),
    check(
      "brand_proposals_author",
      sql`(${t.authorType} = 'agent' and ${t.agentRole} is not null) or (${t.authorType} = 'user' and ${t.authorUserId} is not null)`,
    ),
    check(
      "brand_proposals_reviewed_by_person",
      sql`${t.status} not in ('accepted', 'rejected') or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`,
    ),
  ],
);

/** Approved and rejected examples used as few-shot in generation. */
export const brandExamples = pgTable(
  "brand_examples",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: brandExampleKindEnum("kind").notNull(),
    verdict: brandExampleVerdictEnum("verdict").notNull(),
    body: text("body").notNull(),
    reason: text("reason").notNull(),
    channel: text("channel"),
    pillarKey: text("pillar_key"),
    formatKey: text("format_key"),
    /** Set by the content module when the example comes from a carousel. */
    contentVersionId: uuid("content_version_id"),
    storageKey: text("storage_key"),
    sourceId: uuid("source_id").references(() => brandSources.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("brand_examples_client_idx").on(t.clientId, t.verdict)],
);
