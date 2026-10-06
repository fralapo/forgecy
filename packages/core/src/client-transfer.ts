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
