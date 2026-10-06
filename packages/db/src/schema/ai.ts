import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id } from "./_common";
import { aiPolicyEnum, connectionScopeEnum, providerEnum, scopeEnum } from "./enums";

/**
 * One row per AI provider call (spec: jobs_log). Records provider, model, policy,
 * who authorized it, a summary of the data sent (fields and asset hashes, never
 * the raw content), tokens and cost. Budgets are computed from this table.
 */
export const jobsLog = pgTable(
  "jobs_log",
  {
    id: id(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    contentId: uuid("content_id"),
    status: text("status", { enum: ["ok", "error", "blocked"] }).notNull(),
    provider: providerEnum("provider"),
    model: text("model"),
    policy: aiPolicyEnum("policy"),
    authorizedBy: uuid("authorized_by").references(() => users.id, { onDelete: "set null" }),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
    resultRef: text("result_ref"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Cost in millionths of a US dollar so cheap calls are not rounded to zero. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_log_client_started_idx").on(t.clientId, t.startedAt),
    index("jobs_log_started_idx").on(t.startedAt),
  ],
);

/** Monthly spending caps: warn at `warnAtPercent`, block at 100%. `scopeId` is null for agency scope. */
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    scope: scopeEnum("scope").notNull(),
    scopeId: uuid("scope_id"),
    /** First day of the month, e.g. 2026-10-01. */
    month: text("month").notNull(),
    limitCents: integer("limit_cents").notNull(),
    warnAtPercent: integer("warn_at_percent").notNull().default(70),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("budgets_scope_month_uq").on(
      t.scope,
      sql`coalesce(${t.scopeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.month,
    ),
  ],
);

/**
 * BYOK keys (agency or client), encrypted with FORGECY_ENCRYPTION_KEY outside the DB.
 * Only the last four characters are kept in clear for display.
 */
export const aiConnections = pgTable(
  "ai_connections",
  {
    id: id(),
    scope: connectionScopeEnum("scope").notNull(),
    scopeId: uuid("scope_id"),
    provider: providerEnum("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint").notNull(),
    baseUrl: text("base_url"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    /** Product Owner check of the provider's terms before use with real clients. */
    commercialUseStatus: text("commercial_use_status", {
      enum: ["pending_verification", "verified", "rejected"],
    })
      .notNull()
      .default("pending_verification"),
    allowedModels: jsonb("allowed_models").$type<string[]>().notNull().default([]),
    monthlyLimitCents: integer("monthly_limit_cents"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_connections_scope_idx").on(t.scope, t.scopeId)],
);
