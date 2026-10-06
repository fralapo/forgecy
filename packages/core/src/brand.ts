/**
 * Brand Identity enums (spec tab "Brand Identity"), shared by @forgecy/db and @forgecy/brand.
 * Version and proposal states live in review-status.ts.
 */

/** Who wrote a proposal or did an action. Agents only ever propose. */
export const actorTypes = ["user", "agent"] as const;
export type ActorType = (typeof actorTypes)[number];

/** Confidence is computed by the server from the sources, never reported by the model. */
export const confidenceLevels = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof confidenceLevels)[number];

/**
 * Where a brand fact comes from. The list order is the source hierarchy used to
 * suggest a value when sources disagree (brand book > direct input > site >
 * social > competitor > AI inference); the conflict stays visible either way.
 */
export const brandSourceKinds = [
  "brand_book",
  "document",
  "interview",
  "questionnaire",
  "client_approval",
  "manual",
  "internal_feedback",
  "website",
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "screenshot",
  "audit",
  "competitor",
  "agent_observation",
] as const;
export type BrandSourceKind = (typeof brandSourceKinds)[number];

/** Lifecycle of an imported file or a collected source. */
export const brandSourceStatuses = [
  "pending",
  "extracting",
  "extracted",
  "partial",
  "failed",
] as const;
export type BrandSourceStatus = (typeof brandSourceStatuses)[number];

export const brandExampleKinds = ["copy", "caption", "slide", "image"] as const;
export type BrandExampleKind = (typeof brandExampleKinds)[number];

export const brandExampleVerdicts = ["approved", "rejected"] as const;
export type BrandExampleVerdict = (typeof brandExampleVerdicts)[number];

/**
 * Brand Book exports (v1): the client-facing PDF and the Internal Brand System ZIP.
 * The PDF goes through draft → approved → exported; the ZIP is born `exported`.
 */
export const brandBookTypes = ["client_book", "brand_system"] as const;
export type BrandBookType = (typeof brandBookTypes)[number];

export const brandBookStatuses = ["draft", "approved", "exported", "superseded"] as const;
export type BrandBookStatus = (typeof brandBookStatuses)[number];
