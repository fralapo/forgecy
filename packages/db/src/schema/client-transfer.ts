/**
 * Full client exports (v1, spec page 68). The row outlives the client (set null) so
 * the list keeps showing who exported what; the ZIP lives in storage.
 */
import { clientExportStatuses, clientTransferAreas } from "@forgecy/core";
import { bigint, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
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
