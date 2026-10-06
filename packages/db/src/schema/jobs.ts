import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { MessageRef } from "@forgecy/core";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt, id, updatedAt } from "./_common";
import { jobStatusEnum } from "./enums";

/**
 * Persistent state of every background job. BullMQ moves the work; this table is
 * what the UI reads. `dependsOnJobId` chains pipeline steps so a failed step
 * restarts from itself instead of from the beginning.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    entity: text("entity"),
    entityId: uuid("entity_id"),
    dependsOnJobId: uuid("depends_on_job_id").references((): AnyPgColumn => jobs.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Translatable form of `error` (a key of @forgecy/i18n), shown in the reader's language. */
    errorRef: jsonb("error_ref").$type<MessageRef>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_status_idx").on(t.status),
    index("jobs_entity_idx").on(t.entity, t.entityId),
    index("jobs_client_idx").on(t.clientId),
    index("jobs_active_idx")
      .on(t.updatedAt)
      .where(sql`${t.status} in ('queued', 'running', 'retrying')`),
  ],
);
