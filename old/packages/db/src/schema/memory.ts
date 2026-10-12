/**
 * Agent memory (spec page 56). One row per memory of a client, with every version of
 * its text kept apart; structured settings (slide count, format, language, CTA) are
 * typed values per client, not sentences. Which memories a run used is written in
 * `jobs_log.input_summary.memory`.
 */
import {
  memoryCategories,
  memoryConfidences,
  memorySettingKeys,
  memoryStatuses,
} from "@forgecy/core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agentKeyEnum } from "./agents";
import { jobsLog } from "./ai";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt, id, updatedAt } from "./_common";

export const memoryStatusEnum = pgEnum("memory_status", memoryStatuses);
export const memoryCategoryEnum = pgEnum("memory_category", memoryCategories);
export const memoryConfidenceEnum = pgEnum("memory_confidence", memoryConfidences);
export const memorySettingKeyEnum = pgEnum("memory_setting_key", memorySettingKeys);

export const memoryItems = pgTable(
  "memory_items",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** The agent the memory is for (and, when an agent proposed it, the proposer). */
    agent: agentKeyEnum("agent").notNull(),
    category: memoryCategoryEnum("category").notNull(),
    sensitive: boolean("sensitive").notNull().default(false),
    content: text("content").notNull(),
    status: memoryStatusEnum("status").notNull(),
    confidence: memoryConfidenceEnum("confidence").notNull().default("medium"),
    confidenceReason: text("confidence_reason"),
    version: integer("version").notNull().default(1),
    /** Set when an agent wrote it; null for a memory a person added. */
    proposedByAgent: agentKeyEnum("proposed_by_agent"),
    sourceRunId: uuid("source_run_id").references(() => jobsLog.id, { onDelete: "set null" }),
    sourceNote: text("source_note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Approval note (required at low confidence) or rejection reason. */
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("memory_items_client_status_idx").on(t.clientId, t.status),
    index("memory_items_agent_status_idx").on(t.agent, t.status),
  ],
);

export const memoryItemVersions = pgTable(
  "memory_item_versions",
  {
    id: id(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memoryItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    category: memoryCategoryEnum("category").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorAgent: agentKeyEnum("author_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memory_item_versions_uq").on(t.memoryId, t.version)],
);

export const clientMemorySettings = pgTable(
  "client_memory_settings",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    key: memorySettingKeyEnum("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    version: integer("version").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.key] })],
);
