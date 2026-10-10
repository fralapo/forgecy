/**
 * Instagram profile analysis (ADR 0023). Database enums import these lists from here;
 * the analysis, diff and source code lives in @forgecy/social.
 */

/** What the profile is for the agency: the client itself, a competitor, or a prospect being audited. */
export const socialProfileRoles = ["self", "competitor", "prospect"] as const;
export type SocialProfileRole = (typeof socialProfileRoles)[number];

/**
 * `blocked` means the source answered with a challenge or login wall: everything for that
 * source stops until a person resumes it. `error` is a failure worth retrying later.
 */
export const socialProfileStatuses = ["pending", "ok", "error", "blocked", "paused"] as const;
export type SocialProfileStatus = (typeof socialProfileStatuses)[number];

/** Where a snapshot came from. Numbers from different sources are not compared silently. */
export const socialSnapshotSources = ["graph_api", "public_web", "file_import"] as const;
export type SocialSnapshotSource = (typeof socialSnapshotSources)[number];

export const SOCIAL_LIMITS = {
  /** Profiles that can be monitored at once per client. */
  maxProfilesPerClient: 25,
  /** Shortest monitoring interval. Daily is enough for benchmarking. */
  minIntervalHours: 6,
  defaultIntervalHours: 24,
  /** Hard cap of requests in one snapshot run (all pages of one profile). */
  maxRequestsPerRun: 6,
} as const;
