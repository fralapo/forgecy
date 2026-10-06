import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { users } from "./auth";
import { clients } from "./clients";
import { versionStatusEnum } from "./enums";

/**
 * Template catalog (M3). One row per template version: `key` is the id in template.json,
 * the package itself (HTML, CSS, fonts, assets) is a ZIP in storage, content-addressed.
 * Lifecycle: draft → in_review → published → archived ("approved" is not used here).
 * Published versions never change: a fix is a new version.
 */
export const templates = pgTable(
  "templates",
  {
    id: id(),
    key: text("key").notNull(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    channel: text("channel"),
    format: text("format").notNull(),
    /** "system" (curated by the Product Owner) or "agency". */
    origin: text("origin").notNull().default("agency"),
    /** Assigned to one client; null = every client. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    status: versionStatusEnum("status").notNull().default("draft"),
    /** Parsed template.json, as validated at import. */
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    packageKey: text("package_key").notNull(),
    packageSha256: text("package_sha256").notNull(),
    packageSize: integer("package_size").notNull(),
    /** Last validation report (static checks, plus render checks once the worker ran them). */
    validation: jsonb("validation").$type<Record<string, unknown>>().notNull().default({}),
    versionNotes: text("version_notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("templates_key_version_idx").on(t.key, t.version),
    index("templates_status_idx").on(t.status),
    check("templates_origin_check", sql`${t.origin} in ('agency', 'system')`),
  ],
);
