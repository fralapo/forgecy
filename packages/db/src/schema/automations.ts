/**
 * Batch automations (v1, spec pages 58–59). The configuration (items and common
 * parameters) lives on the automation as JSON validated by @forgecy/automations; each
 * execution is a run, and each carousel of a run is a run item with its own status,
 * step, cost and carousel.
 */
import {
  automationItemStatuses,
  automationItemSteps,
  automationRunStatuses,
  automationSources,
  automationStatuses,
  automationStopPoints,
} from "@forgecy/core";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { contents } from "./content";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";

export const automationSourceEnum = pgEnum("automation_source", automationSources);
export const automationStatusEnum = pgEnum("automation_status", automationStatuses);
export const automationStopPointEnum = pgEnum("automation_stop_point", automationStopPoints);
export const automationRunStatusEnum = pgEnum("automation_run_status", automationRunStatuses);
export const automationItemStatusEnum = pgEnum("automation_item_status", automationItemStatuses);
export const automationItemStepEnum = pgEnum("automation_item_step", automationItemSteps);

export const automations = pgTable(
  "automations",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: automationSourceEnum("source").notNull(),
    status: automationStatusEnum("status").notNull().default("draft"),
    /** Why the automation is paused or failed, as an i18n message reference. */
    statusReason: jsonb("status_reason").$type<{ key: string; values?: Record<string, unknown> }>(),
    stopAt: automationStopPointEnum("stop_at").notNull().default("outline"),
    /** Common carousel parameters (format, slide count, language, template, audiences). */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /** The items, one per carousel, in order. */
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull().default([]),
    /** Optimistic concurrency for the configuration (`CONFLICT-DRAFT-REV`). */
    draftRev: integer("draft_rev").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("automations_client_idx").on(t.clientId),
    index("automations_updated_idx").on(t.updatedAt),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: id(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Run n of the automation. */
    number: integer("number").notNull(),
    status: automationRunStatusEnum("status").notNull().default("running"),
    stopAt: automationStopPointEnum("stop_at").notNull(),
    /** Cost estimate shown when it started, in micro-dollars. */
    estimateMicroUsd: bigint("estimate_micro_usd", { mode: "number" }).notNull().default(0),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("automation_runs_number_uq").on(t.automationId, t.number),
    index("automation_runs_client_idx").on(t.clientId, t.startedAt),
  ],
);

export const automationRunItems = pgTable(
  "automation_run_items",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** Position in the run, starting at 0: items run in this order, one at a time. */
    position: integer("position").notNull(),
    /** The configuration item it came from (its id inside `automations.items`). */
    itemKey: text("item_key").notNull(),
    title: text("title").notNull().default(""),
    /** The configuration of this item when the run started. */
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    status: automationItemStatusEnum("status").notNull().default("queued"),
    step: automationItemStepEnum("step").notNull().default("pending"),
    contentId: uuid("content_id").references(() => contents.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    /** Short error code shown in the table (e.g. `BUDGET-EXCEEDED`). */
    errorCode: text("error_code"),
    error: text("error"),
    errorRef: jsonb("error_ref").$type<{ key: string; values?: Record<string, unknown> }>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("automation_run_items_position_uq").on(t.runId, t.position),
    index("automation_run_items_content_idx").on(t.contentId),
  ],
);
