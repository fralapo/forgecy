/**
 * Content Strategy and carousel enums (spec pages 31–48), shared by @forgecy/db and
 * @forgecy/content. The content state machine itself lives in content-status.ts.
 */

/** Objective of a carousel (page 40, UXA-P3-36). */
export const contentObjectives = ["awareness", "education", "conversion", "community"] as const;
export type ContentObjective = (typeof contentObjectives)[number];

/** Funnel stage of a pillar (page 32, UXA-P3-14). */
export const funnelStages = ["awareness", "consideration", "conversion", "loyalty"] as const;
export type FunnelStage = (typeof funnelStages)[number];

/**
 * Pillars, rubrics and plan items: a Planner proposal is a row in `proposed` that a
 * person accepts or rejects; a person creates rows directly in `accepted`.
 */
export const strategyItemStatuses = [
  "proposed",
  "accepted",
  "rejected",
  "stale",
  "archived",
] as const;
export type StrategyItemStatus = (typeof strategyItemStatuses)[number];

/** A new plan from the Planner never replaces the one in use until a person accepts it. */
export const contentPlanStatuses = ["proposed", "active", "superseded"] as const;
export type ContentPlanStatus = (typeof contentPlanStatuses)[number];

/** Why a content version exists (spec: created_from). */
export const contentVersionOrigins = ["ai", "manual", "restore", "submit"] as const;
export type ContentVersionOrigin = (typeof contentVersionOrigins)[number];

/** Asset library: AI images stay drafts until a person approves them. */
export const assetStatuses = ["draft", "approved", "rejected"] as const;
export type AssetStatus = (typeof assetStatuses)[number];

export const assetSources = ["upload", "ai", "product"] as const;
export type AssetSource = (typeof assetSources)[number];

export const approvalDecisions = ["approved", "changes_requested"] as const;
export type ApprovalDecision = (typeof approvalDecisions)[number];

export const frequencyUnits = ["week", "month"] as const;
/** Where an outline version came from (differs from `contentVersionOrigins`, which has "submit"). */
export const outlineOrigins = ["ai", "manual", "restore"] as const;
export const slideEditStatuses = ["queued", "applied", "kept", "reverted", "failed"] as const;
export const contentTypes = ["carousel"] as const;
export const contentAssetKinds = ["image"] as const;
