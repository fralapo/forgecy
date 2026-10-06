import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { updatedAt } from "./_common";

/**
 * Append-only activity log: who did what. `actor` is "user:<id>", "agent:<role>" or
 * "system"; `meta` carries model, provider, prompt and brand versions for AI actions.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    clientId: uuid("client_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_entity_idx").on(t.entity, t.entityId),
    index("audit_events_at_idx").on(t.at),
  ],
);

/** Instance-wide settings edited by Admins (installed version, per-task providers, SMTP overrides...). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});
