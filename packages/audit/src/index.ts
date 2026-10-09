// Web-safe entry: services, queries and helpers. Worker handlers (Playwright) live
// in "@forgecy/audit/handlers" so the web bundle never loads the browser.
export * from "./errors";
export * from "./jobs";
export * from "./url";
export * from "./social/table";
export * from "./social/metrics";
export * from "./service/common";
export * from "./service/prospects";
export * from "./service/audits";
export * from "./service/findings";
export * from "./service/competitors";
export * from "./service/social";
export * from "./service/queries";
export * from "./service/reports";
// measureBrand runs in the browser only: the web entry exposes the types and the pure helpers.
export {
  buildSiteProbe,
  parseJsonLdOrganization,
  rankLogoCandidates,
  toHex,
  type FontRole,
  type ProbeImage,
  type RawProbe,
  type SiteProbe,
} from "./crawl/brand-probe";
