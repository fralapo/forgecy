/**
 * Brand Guard (spec Page 46, "Carousel brand check"): severities, origins and the
 * states a person can give a finding. Agents never ignore, resolve or confirm findings.
 */
export const brandCheckSeverities = ["error", "warning", "note"] as const;
export type BrandCheckSeverity = (typeof brandCheckSeverities)[number];

/** `json`: checked on the slide data; `render`: measured on the rendered page. */
export const brandCheckOrigins = ["json", "render"] as const;
export type BrandCheckOrigin = (typeof brandCheckOrigins)[number];

/** `ignored`: "Ignore for this content" (warnings and notes only); `acknowledged`: "I’ve seen it" in approval. */
export const brandCheckIssueStatuses = ["ignored", "acknowledged"] as const;
export type BrandCheckIssueStatus = (typeof brandCheckIssueStatuses)[number];

export const brandCheckIgnoreReasons = [
  "client_request",
  "creative_choice",
  "false_positive",
  "other",
] as const;
export type BrandCheckIgnoreReason = (typeof brandCheckIgnoreReasons)[number];
