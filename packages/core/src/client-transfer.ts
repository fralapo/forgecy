import { z } from "zod";

/**
 * Full client export and import (v1, spec page 68): everything about one client in a
 * single ZIP, which can be imported back here or into another Forgecy installation.
 */

/** What a package can contain; every area is selected by default. */
export const clientTransferAreas = [
  "brand",
  "brandBook",
  "templates",
  "audit",
  "content",
  "products",
  "reports",
  "activity",
] as const;
export type ClientTransferArea = (typeof clientTransferAreas)[number];

export const clientExportStatuses = ["queued", "running", "ready", "failed"] as const;
export type ClientExportStatus = (typeof clientExportStatuses)[number];

/** Package format written in manifest.json; a newer one cannot be imported. */
export const CLIENT_PACKAGE_FORMAT = 1;

/** How long a download link of a finished export stays valid. */
export const CLIENT_EXPORT_LINK_HOURS = 24;

/**
 * Import of a package, a wizard in four steps (File, Verify, Conflicts, Confirm):
 * `verifying` (worker reads and checks the ZIP) → `invalid` or `ready` (waiting for
 * the choices) → `importing` → `done` or `failed`. `cancelled` before the confirmation.
 */
export const clientImportStatuses = [
  "verifying",
  "invalid",
  "ready",
  "importing",
  "done",
  "failed",
  "cancelled",
] as const;
export type ClientImportStatus = (typeof clientImportStatuses)[number];

/** Largest package accepted by the upload. */
export const CLIENT_PACKAGE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Limits applied while reading a package (the upload cap above is its compressed size). */
export const CLIENT_PACKAGE_MAX_ENTRIES = 200_000;
/** Absolute ceiling on the inflated size of a whole package. */
export const CLIENT_PACKAGE_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024;
/** Largest `manifest.json`, `data/*.json` or `people.json` that is parsed in memory. */
export const CLIENT_PACKAGE_MAX_JSON_BYTES = 64 * 1024 * 1024;
/** All the JSON text of one open package together (distinct entries). */
export const CLIENT_PACKAGE_MAX_JSON_TOTAL_BYTES = 256 * 1024 * 1024;
/**
 * A package may inflate to at most this many times its own size, but never below the floor
 * (repetitive but legitimate data compresses a lot) and never above the absolute ceiling.
 */
export const CLIENT_PACKAGE_MAX_RATIO = 200;
export const CLIENT_PACKAGE_RATIO_FLOOR_BYTES = 1024 * 1024 * 1024;

/** Why a package cannot be imported (each one blocks). */
export const clientImportProblems = [
  "unreadable",
  "format",
  "newerVersion",
  "checksum",
  "unknownTable",
  "unsafe",
  "incompleteArea",
] as const;
export type ClientImportProblem = (typeof clientImportProblems)[number];

/** A conflict needs a choice before the import can be confirmed. */
export const clientImportConflictSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("client"),
    name: z.string(),
    slug: z.string(),
    existingId: z.uuid(),
    existingName: z.string(),
    proposedSlug: z.string(),
  }),
  z.object({
    kind: z.literal("template"),
    key: z.string(),
    version: z.string(),
    name: z.string(),
    existingVersions: z.array(z.string()),
  }),
]);
export type ClientImportConflict = z.infer<typeof clientImportConflictSchema>;

/** Settled without asking; listed in the Conflicts step. */
export const clientImportResolvedSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("templateReused"), key: z.string(), version: z.string() }),
  z.object({ kind: z.literal("authorMissing"), name: z.string(), email: z.string() }),
  z.object({ kind: z.literal("authorMatched"), name: z.string(), email: z.string() }),
]);
export type ClientImportResolved = z.infer<typeof clientImportResolvedSchema>;

export const CLIENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The choices of the Conflicts step. */
export const clientImportChoicesSchema = z.object({
  client: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("new"),
      slug: z.string().min(1).max(80).regex(CLIENT_SLUG_PATTERN),
    }),
    z.object({ mode: z.literal("replace") }),
  ]),
  /** Keyed by `key@version`. */
  templates: z.record(z.string(), z.enum(["useExisting", "importDraft"])).default({}),
});
export type ClientImportChoices = z.infer<typeof clientImportChoicesSchema>;

export function templateConflictId(key: string, version: string): string {
  return `${key}@${version}`;
}
