/**
 * Browser-safe entry point for the web app's client components: schemas, labels,
 * deterministic checks. No database, storage or AI imports.
 */
export * from "./document";
export * from "./labels";
export * from "./carousels/checks";
export * from "./carousels/compare";
export { GUARDED_CHECK_PREFIXES, findingsToAcknowledge } from "./carousels/brand-guard";
export type { GuardBand, GuardFinding, GuardReport, GuardSeverity } from "./carousels/brand-guard";
