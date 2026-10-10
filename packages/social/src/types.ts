/**
 * Source-agnostic model of a public Instagram business profile. Adapters (Graph API,
 * public web, CSV export) produce these; analysis, diff and edges only read them.
 * Every value is null when the source did not give it: nothing is estimated.
 */

export const snapshotSources = ["graph_api", "public_web", "file_import"] as const;
export type SnapshotSource = (typeof snapshotSources)[number];

export const mediaKinds = ["image", "video", "carousel", "reel"] as const;
export type MediaKind = (typeof mediaKinds)[number];

/** Lowercase handle without "@". */
export type Handle = string;

export interface ProfileSnapshot {
  handle: Handle;
  fullName: string | null;
  biography: string | null;
  externalUrl: string | null;
  /** Business category as the source words it. */
  category: string | null;
  isBusiness: boolean | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  followers: number | null;
  following: number | null;
  postsTotal: number | null;
  /** sha256 hex of the profile picture bytes (never the bytes), to detect a change. */
  pictureHash: string | null;
  /** ISO-8601 UTC, when the source was read. */
  observedAt: string;
  source: SnapshotSource;
}

export interface PostSnapshot {
  /** Stable id from the source (shortcode or media id). */
  id: string;
  shortcode: string | null;
  /** ISO-8601 UTC. */
  postedAt: string;
  /**
   * How exact `postedAt` is: "time" is the real moment, "day" is only the date (set to noon UTC),
   * as the public profile grid gives it. Absent means "time". Hour and weekday analysis skips
   * "day" posts.
   */
  postedAtPrecision?: "day" | "time";
  kind: MediaKind;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Lowercase, without "#". */
  hashtags: string[];
  /** Lowercase handles written in the caption, without "@". */
  mentions: Handle[];
  /** Accounts tagged in the media. */
  taggedAccounts: Handle[];
  /** Co-authors of a collab post. */
  collaborators: Handle[];
  location: string | null;
  isSponsored: boolean;
  isPinned: boolean | null;
  /** Slides of a carousel. */
  carouselCount: number | null;
  /** Alt text the author or the platform gave. */
  accessibilityCaption: string | null;
}

export interface ProfileData {
  profile: ProfileSnapshot;
  /** Newest first, at most what the source returned. Empty for a private account. */
  posts: PostSnapshot[];
}

/** Why a source could not give data. The job decides what to do from this. */
export const sourceFailures = [
  /** Network error, timeout, 5xx: retry later. */
  "transport",
  /** The response no longer has the expected shape: the adapter needs an update. */
  "api_drift",
  /** Challenge, checkpoint, login wall or "feedback required": stop everything, tell a person. */
  "blocked",
  /** 429: wait and retry within the budget. */
  "rate_limited",
  "not_found",
  /** Private account: nothing to read. */
  "private",
  /** Token missing or refused (Graph API). */
  "unauthorized",
  /** The adapter is switched off in this installation. */
  "disabled",
] as const;
export type SourceFailure = (typeof sourceFailures)[number];

export class SourceError extends Error {
  constructor(
    readonly failure: SourceFailure,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Runs one request inside the pacing, budget and circuit-breaker policy of a source. */
export interface RequestGuard {
  run<T>(bucket: string, fn: () => Promise<T>): Promise<T>;
}

export interface FetchOptions {
  /** Only posts newer than this ISO timestamp are needed (incremental fetch). */
  since?: string | null;
  /** Upper bound of posts to return. */
  limit?: number;
}

export interface ProfileSource {
  readonly id: SnapshotSource;
  /** Throws SourceError. */
  fetchProfile(handle: Handle, options?: FetchOptions): Promise<ProfileData>;
}

/** Minimal fetch used by adapters, so tests inject a fake and production injects undici. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;
