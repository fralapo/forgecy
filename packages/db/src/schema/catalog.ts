import {
  imageMatchMethods,
  importFileKinds,
  importFileRoutes,
  importImageStates,
  importItemStatuses,
  productImageStatuses,
  productImportStatuses,
  productStatuses,
  type MessageRef,
} from "@forgecy/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { confidenceEnum } from "./brand";
import { clients } from "./clients";
import { jobs } from "./jobs";
import { createdAt, id, updatedAt } from "./_common";
import { proposalStatusEnum } from "./enums";

// Product catalog (spec pages 71–74). Typed shapes of the jsonb columns live in
// @forgecy/catalog; here they stay generic so the db package doesn't depend on it.
type Json = Record<string, unknown>;

export const productStatusEnum = pgEnum("product_status", productStatuses);
export const productImportStatusEnum = pgEnum("product_import_status", productImportStatuses);
export const importFileKindEnum = pgEnum("import_file_kind", importFileKinds);
export const importFileRouteEnum = pgEnum("import_file_route", importFileRoutes);
export const importItemStatusEnum = pgEnum("import_item_status", importItemStatuses);
export const imageMatchMethodEnum = pgEnum("image_match_method", imageMatchMethods);
export const productImageStatusEnum = pgEnum("product_image_status", productImageStatuses);
export const importImageStateEnum = pgEnum("import_image_state", importImageStates);

/** One import: mixed files uploaded together, analyzed by one job, reviewed once. */
export const productImports = pgTable(
  "product_imports",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: productImportStatusEnum("status").notNull().default("uploading"),
    /** language, matchImages, official, aiConfirmed. */
    options: jsonb("options").$type<Json>().notNull().default({}),
    /** Counters shown in banners and the review summary. */
    summary: jsonb("summary").$type<Json>().notNull().default({}),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    error: text("error"),
    failedStep: text("failed_step"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("product_imports_client_idx").on(t.clientId, t.status)],
);

/** Files of an import, including the entries expanded from a ZIP (parentId). */
export const productImportFiles = pgTable(
  "product_import_files",
  {
    id: id(),
    importId: uuid("import_id")
      .notNull()
      .references(() => productImports.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => productImportFiles.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    /** Relative path inside the uploaded folder or ZIP. */
    path: text("path").notNull(),
    kind: importFileKindEnum("kind").notNull(),
    format: text("format"),
    route: importFileRouteEnum("route").notNull(),
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    size: integer("size").notNull().default(0),
    mime: text("mime"),
    valid: boolean("valid").notNull().default(true),
    errorCode: text("error_code"),
    message: text("message"),
    /** rows, headers, sample, pages, textless, encoding, delimiter, archive counts... */
    meta: jsonb("meta").$type<Json>().notNull().default({}),
    /** Confirmed column mapping (sheets). */
    mapping: jsonb("mapping").$type<Json>(),
    /** Proposed mapping with confidence per column, before a person confirms it. */
    mappingProposal: jsonb("mapping_proposal").$type<Json>(),
    mappingConfirmedBy: uuid("mapping_confirmed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    mappingConfirmedAt: timestamp("mapping_confirmed_at", { withTimezone: true }),
    /** Images only: assignment state in the review. */
    imageState: importImageStateEnum("image_state"),
    /** AI suggestion for an unassigned image: { itemId?, productId?, confidence }. */
    suggestion: jsonb("suggestion").$type<Json>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_import_files_import_idx").on(t.importId),
    index("product_import_files_parent_idx").on(t.parentId),
  ],
);

/** Saved column mappings per client ("Standard price list"). */
export const productColumnMappings = pgTable(
  "product_column_mappings",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Normalized header row, to reapply the mapping automatically. */
    signature: text("signature").notNull(),
    mapping: jsonb("mapping").$type<Json>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("product_column_mappings_name_uq").on(t.clientId, t.name),
    index("product_column_mappings_sig_idx").on(t.clientId, t.signature),
  ],
);

/**
 * The catalog. Searchable fields are columns; descriptions, "Technical sheet",
 * benefits, variants and optional commercial data live in `details`. `fieldMeta`
 * keeps truth level, exact source and confidence per field. `revision` guards
 * against two people overwriting each other.
 */
export const products = pgTable(
  "products",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: productStatusEnum("status").notNull().default("draft"),
    name: text("name").notNull(),
    sku: text("sku"),
    category: text("category"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    details: jsonb("details").$type<Json>().notNull().default({}),
    fieldMeta: jsonb("field_meta").$type<Json>().notNull().default({}),
    /** Origin of the product ({ kind, fileName, importId... }), for the "Fonte" column. */
    origin: jsonb("origin").$type<Json>().notNull().default({}),
    sourceImportId: uuid("source_import_id").references(() => productImports.id, {
      onDelete: "set null",
    }),
    proposedByAgent: boolean("proposed_by_agent").notNull().default(false),
    revision: integer("revision").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    rejectedReason: text("rejected_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_client_status_idx").on(t.clientId, t.status),
    index("products_client_sku_idx").on(t.clientId, t.sku),
    index("products_import_idx").on(t.sourceImportId),
  ],
);

/** Photos of a product, stored content-addressed in @forgecy/files. */
export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime").notNull(),
    fileName: text("file_name").notNull(),
    alt: text("alt"),
    status: productImageStatusEnum("status").notNull().default("draft"),
    matchMethod: imageMatchMethodEnum("match_method").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("high"),
    isPrimary: boolean("is_primary").notNull().default(false),
    position: integer("position").notNull().default(0),
    sourceImportId: uuid("source_import_id").references(() => productImports.id, {
      onDelete: "set null",
    }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_images_product_idx").on(t.productId),
    uniqueIndex("product_images_product_sha_uq").on(t.productId, t.sha256),
  ],
);

/**
 * Field proposals on an existing product (merge from an import, re-extraction).
 * An approved value is never overwritten silently: a person accepts or rejects.
 */
export const productFieldProposals = pgTable(
  "product_field_proposals",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    currentValue: jsonb("current_value").$type<unknown>(),
    proposedValue: jsonb("proposed_value").$type<unknown>().notNull(),
    meta: jsonb("meta").$type<Json>().notNull().default({}),
    status: proposalStatusEnum("status").notNull().default("proposed"),
    importId: uuid("import_id").references(() => productImports.id, { onDelete: "set null" }),
    proposedBy: text("proposed_by").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_field_proposals_product_idx").on(t.productId, t.status),
    index("product_field_proposals_client_idx").on(t.clientId, t.status),
  ],
);

/** Products found by an import, waiting for a review decision (page 74). */
export const productImportItems = pgTable(
  "product_import_items",
  {
    id: id(),
    importId: uuid("import_id")
      .notNull()
      .references(() => productImports.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: importItemStatusEnum("status").notNull().default("pending"),
    position: integer("position").notNull().default(0),
    draft: jsonb("draft").$type<Json>().notNull().default({}),
    fieldMeta: jsonb("field_meta").$type<Json>().notNull().default({}),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    sensitive: boolean("sensitive").notNull().default(false),
    origin: jsonb("origin").$type<Json>().notNull().default({}),
    /** Import files (images) attached to this item: [{ fileId, method, confidence }]. */
    images: jsonb("images").$type<Json[]>().notNull().default([]),
    proposedByAgent: boolean("proposed_by_agent").notNull().default(false),
    /** Existing product with the same SKU, or name + category. */
    matchProductId: uuid("match_product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    matchReason: text("match_reason"),
    /** `matchReason` as a message reference, shown in the reader's language. */
    matchRef: jsonb("match_ref").$type<MessageRef>(),
    /** Snapshot of the matched product's revision when compared. */
    matchRevision: integer("match_revision"),
    /** Differences with approved values: [{ field, approved, incoming }]. */
    conflicts: jsonb("conflicts").$type<Json[]>().notNull().default([]),
    /** Per-field decisions on conflicts: { field: "keep" | "accept" | "defer" }. */
    conflictDecisions: jsonb("conflict_decisions").$type<Json>().notNull().default({}),
    resolution: text("resolution"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    discardReason: text("discard_reason"),
    /** `discardReason` as a message reference; null for reasons typed by a person. */
    discardRef: jsonb("discard_ref").$type<MessageRef>(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("product_import_items_import_idx").on(t.importId, t.status),
    index("product_import_items_match_idx").on(t.matchProductId),
  ],
);
