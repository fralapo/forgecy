/**
 * Full client exports (v1, spec page 68). The row outlives the client (set null) so
 * the list keeps showing who exported what; the ZIP lives in storage.
 */
import {
  clientExportStatuses,
  clientImportStatuses,
  clientTransferAreas,
  type ClientImportChoices,
  type ClientImportConflict,
  type ClientImportProblem,
  type ClientImportResolved,
} from "@forgecy/core";
import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";

export const clientExportStatusEnum = pgEnum("client_export_status", clientExportStatuses);

export const clientExports = pgTable(
  "client_exports",
  {
    id: id(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    /** Kept for the list after the client is gone. */
    clientName: text("client_name").notNull(),
    areas: text("areas", { enum: clientTransferAreas }).array().notNull(),
    options: jsonb("options")
      .$type<{ excludeUnapprovedAi: boolean; includeAgencyTemplates: boolean }>()
      .notNull(),
    status: clientExportStatusEnum("status").notNull().default("queued"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    bytes: bigint("bytes", { mode: "number" }),
    /** Rows per table and number of files, as written in manifest.json. */
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    /** Why it failed, as an i18n message reference. */
    errorRef: jsonb("error_ref").$type<{ key: string; values?: Record<string, unknown> }>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_exports_created_idx").on(t.createdAt)],
);

export const clientImportStatusEnum = pgEnum("client_import_status", clientImportStatuses);

/** What the Verify step read from a package. */
export interface ClientImportReport {
  format: number;
  exportedAt: string;
  schemaMigrations: number;
  client: { name: string; slug: string };
  areas: string[];
  /** Rows per area, plus `files`. */
  counts: Record<string, number>;
  /** Package size in bytes. */
  bytes: number;
}

/**
 * Imports of client packages (v1, spec page 68). The uploaded ZIP stays in storage until
 * the import ends; nothing is written to the client tables before the confirmation.
 */
export const clientImports = pgTable(
  "client_imports",
  {
    id: id(),
    fileName: text("file_name").notNull(),
    storageKey: text("storage_key").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    status: clientImportStatusEnum("status").notNull().default("verifying"),
    report: jsonb("report").$type<ClientImportReport>(),
    problems: jsonb("problems").$type<ClientImportProblem[]>().notNull().default([]),
    conflicts: jsonb("conflicts").$type<ClientImportConflict[]>().notNull().default([]),
    resolved: jsonb("resolved").$type<ClientImportResolved[]>().notNull().default([]),
    choices: jsonb("choices").$type<ClientImportChoices>(),
    /** The client created or replaced. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    /** Rows written per area, plus `files`. */
    result: jsonb("result").$type<Record<string, number>>(),
    /** Backup made before a replacement. */
    backupName: text("backup_name"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    errorRef: jsonb("error_ref").$type<{ key: string; values?: Record<string, unknown> }>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_imports_created_idx").on(t.createdAt)],
);
