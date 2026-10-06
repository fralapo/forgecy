/**
 * Brand Book exports (v1). Each generation is a saved, numbered artifact (BB-n per
 * client) tied to the Brand Identity version and, for the PDF, the template version.
 */
import { brandBookStatuses, brandBookTypes } from "@forgecy/core";
import {
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
import { brandIdentityVersions } from "./brand";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";

export const brandBookTypeEnum = pgEnum("brand_book_type", brandBookTypes);
export const brandBookStatusEnum = pgEnum("brand_book_status", brandBookStatuses);

export const brandBookExports = pgTable(
  "brand_book_exports",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** BB-n, counted per client. */
    number: integer("number").notNull(),
    type: brandBookTypeEnum("type").notNull(),
    status: brandBookStatusEnum("status").notNull(),
    brandVersionId: uuid("brand_version_id")
      .notNull()
      .references(() => brandIdentityVersions.id, { onDelete: "restrict" }),
    brandVersionNumber: integer("brand_version_number").notNull(),
    templateKey: text("template_key"),
    templateVersion: text("template_version"),
    language: text("language").notNull().default("en"),
    /** Sections (PDF) or files (ZIP) the person chose, in order. */
    parts: jsonb("parts").$type<string[]>().notNull().default([]),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    bytes: integer("bytes"),
    pages: integer("pages"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brand_book_exports_number_uq").on(t.clientId, t.number),
    index("brand_book_exports_client_idx").on(t.clientId, t.createdAt),
  ],
);
