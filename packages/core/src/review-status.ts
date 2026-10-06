/**
 * Shared lifecycle enums reused by several modules, kept in one place so the
 * database enums and the Zod schemas never drift apart.
 */
/** memory_items and Brand Identity items (spec: observed, proposed, approved, deprecated). */
export const itemStatuses = ["observed", "proposed", "approved", "deprecated"] as const;
export type ItemStatus = (typeof itemStatuses)[number];

/** brand_identity_versions.status */
export const versionStatuses = ["draft", "in_review", "approved", "published", "archived"] as const;
export type VersionStatus = (typeof versionStatuses)[number];

/** AI proposals (brand_identity_proposals and similar). */
export const proposalStatuses = ["proposed", "accepted", "rejected", "stale"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

export const clientStatuses = ["prospect", "active", "archived"] as const;
export type ClientStatus = (typeof clientStatuses)[number];
