/**
 * Product catalog enums (spec pages 71–74). Kept here, like every enum, so the
 * database enums and the Zod schemas of @forgecy/catalog never drift apart.
 */

/** products.status: only `approved` products can be used in strategy and carousels. */
export const productStatuses = ["draft", "proposed", "approved", "rejected", "archived"] as const;
export type ProductStatus = (typeof productStatuses)[number];

/** product_imports.status */
export const productImportStatuses = [
  "uploading",
  "analyzing",
  "needs_mapping",
  "ready_for_review",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type ProductImportStatus = (typeof productImportStatuses)[number];

/** What a file in an import is, once recognized. */
export const importFileKinds = ["sheet", "pdf", "image", "text", "archive", "ignored"] as const;
export type ImportFileKind = (typeof importFileKinds)[number];

/** The path proposed for a file; the user can change it before the analysis. */
export const importFileRoutes = ["map", "match", "extract", "source", "ignore"] as const;
export type ImportFileRoute = (typeof importFileRoutes)[number];

/** Review decision on one extracted product. */
export const importItemStatuses = [
  "pending",
  "accepted",
  "approved",
  "merged",
  "discarded",
] as const;
export type ImportItemStatus = (typeof importItemStatuses)[number];

/** Where a field value comes from. */
export const productSourceKinds = ["csv", "xlsx", "pdf", "image", "text", "manual", "ai"] as const;
export type ProductSourceKind = (typeof productSourceKinds)[number];

/** Shown as Alta / Media / Bassa, never as a percentage. */
export const confidenceLevels = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof confidenceLevels)[number];

/** How an image ended up attached to a product. */
export const imageMatchMethods = ["folder", "filename", "sku", "sheet", "ai", "manual"] as const;
export type ImageMatchMethod = (typeof imageMatchMethods)[number];

/** Product photos: only `approved` ones are reusable in carousels (UXA-P6-21). */
export const productImageStatuses = ["draft", "approved"] as const;
export type ProductImageStatus = (typeof productImageStatuses)[number];

/** Image files of an import, until they are assigned to a product or ignored. */
export const importImageStates = ["unassigned", "assigned", "ignored"] as const;
export type ImportImageState = (typeof importImageStates)[number];
