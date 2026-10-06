// Public API of @forgecy/brand-guard (M6). The Contents module builds a GuardContent
// from its carousel (plus the renderer's measures), calls runBrandCheck on save and on
// “Rerun checks”, shows getBrandCheck on the check page and calls
// confirmBrandCheckForApproval inside its approve transaction.
export * from "./types";
export {
  checkContent,
  contrastThreshold,
  countBySeverity,
  countWords,
  DEFAULTS,
  extractFacts,
  SENSITIVE_CLAIMS,
  type CheckOptions,
  type GuardBrand,
} from "./checks";
export * from "./score";
export * from "./review";
export * from "./service";
