/**
 * Listening grid (ADR 0025): verbatim signals from a client's audience. Database enums import
 * these lists from here; the service lives in @forgecy/social (`listening.ts`).
 */

/** Where the signal was heard. */
export const listeningPlatforms = ["instagram", "facebook", "linkedin", "tiktok", "other"] as const;
export type ListeningPlatform = (typeof listeningPlatforms)[number];

/**
 * `recurring` is the mark for a question that keeps coming back: the one worth a content
 * candidate. `used` means a person already turned it into content.
 */
export const listeningStatuses = ["new", "recurring", "used", "dismissed"] as const;
export type ListeningStatus = (typeof listeningStatuses)[number];
