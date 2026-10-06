/**
 * Brand Guard (M6). A run stores the full report of one check of a content
 * (findings with evidence, counts, coherence) against a Brand Identity version.
 * Issue states record what a *person* decided about a finding: "Ignora per questo
 * contenuto" (with a reason) or "Ho visto" in approval. Agents never write states.
 *
 * The checked content is referenced generically (`subject_type` + `subject_id`), so
 * the Contents module can attach checks to carousels without this module owning them.
 */
import { brandCheckIgnoreReasons, brandCheckIssueStatuses } from "@forgecy/core";
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { brandIdentityVersions } from "./brand";
import { clients } from "./clients";
import { createdAt, id } from "./_common";

export const brandCheckIssueStatusEnum = pgEnum(
  "brand_check_issue_status",
  brandCheckIssueStatuses,
);
export const brandCheckIgnoreReasonEnum = pgEnum(
  "brand_check_ignore_reason",
  brandCheckIgnoreReasons,
);

export const brandCheckRuns = pgTable(
  "brand_check_runs",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** What was checked, e.g. "carousel". */
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Content version number the check ran on, when the subject is versioned. */
    subjectVersion: integer("subject_version"),
    brandIdentityVersionId: uuid("brand_identity_version_id")
      .notNull()
      .references(() => brandIdentityVersions.id, { onDelete: "cascade" }),
    hasRender: boolean("has_render").notNull().default(false),
    /** BrandCheckReport (see @forgecy/brand-guard), without person decisions. */
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    errors: integer("errors").notNull().default(0),
    warnings: integer("warnings").notNull().default(0),
    notes: integer("notes").notNull().default(0),
    /** Coherence score 0-100, always shown with its band and findings. */
    score: integer("score").notNull(),
    /** actorKey of who ran it ("user:<id>" or "agent:reviewer"). */
    runBy: text("run_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("brand_check_runs_subject_idx").on(t.subjectType, t.subjectId, t.createdAt),
    index("brand_check_runs_client_idx").on(t.clientId),
    index("brand_check_runs_brand_version_idx").on(t.brandIdentityVersionId),
    check("brand_check_runs_score_range", sql`${t.score} between 0 and 100`),
  ],
);

export const brandCheckIssueStates = pgTable(
  "brand_check_issue_states",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** Stable key of the finding (check, slide, slot). */
    findingKey: text("finding_key").notNull(),
    /** Hash of the block when the decision was taken: if the block changes, an ignore reopens. */
    blockHash: text("block_hash").notNull(),
    status: brandCheckIssueStatusEnum("status").notNull(),
    reason: brandCheckIgnoreReasonEnum("reason"),
    note: text("note"),
    /** "Ho visto" is per content version; ignores hold across versions (null). */
    subjectVersion: integer("subject_version"),
    /** Always a person: agents cannot ignore or confirm findings. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("brand_check_states_uq")
      .on(t.subjectType, t.subjectId, t.findingKey, t.status, t.subjectVersion)
      .nullsNotDistinct(),
    index("brand_check_states_subject_idx").on(t.subjectType, t.subjectId),
    index("brand_check_states_user_idx").on(t.userId),
    check(
      "brand_check_states_ignore_reason",
      sql`${t.status} <> 'ignored' or ${t.reason} is not null`,
    ),
    check(
      "brand_check_states_other_note",
      sql`${t.reason} is distinct from 'other' or (${t.note} is not null and length(${t.note}) between 1 and 280)`,
    ),
  ],
);
