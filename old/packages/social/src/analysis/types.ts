import type { Handle, MediaKind, SnapshotSource } from "../types";

/** What the numbers below were computed from. Shown next to every card. */
export interface Basis {
  postsUsed: number;
  /** ISO of the oldest and newest post used, null when none. */
  from: string | null;
  to: string | null;
  source: SnapshotSource;
  /** ISO when the profile was read. */
  observedAt: string;
}

export interface KindMix {
  count: number;
  /** 0..1 of postsUsed. */
  share: number;
  /** Mean likes+comments of the posts of this kind that have both, null when none do. */
  avgInteractions: number | null;
}

export interface ContentMix {
  total: number;
  byKind: Record<MediaKind, KindMix>;
  /** 0..1, posts flagged as paid partnership. */
  sponsoredShare: number;
  /** 0..1, posts with at least one collaborator. */
  collabShare: number;
  /** Mean slides of carousels, null when there is no carousel with a count. */
  avgCarouselSlides: number | null;
}

export interface HashtagCount {
  tag: string;
  count: number;
  /** Mean likes+comments of the posts that use it, null when unknown. */
  avgInteractions: number | null;
}

export interface HashtagStats {
  postsWithHashtags: number;
  /** Mean hashtags per post over postsUsed, null when no posts. */
  avgPerPost: number | null;
  distinct: number;
  top: HashtagCount[];
}

export interface SlotCount {
  /** 0 = Monday ... 6 = Sunday, in the requested time zone. */
  weekday: number;
  hour: number;
  count: number;
}

export interface Cadence {
  /** Posts per week over the observed span (at least 7 days), null with fewer than 2 posts. */
  postsPerWeek: number | null;
  medianGapHours: number | null;
  lastPostAt: string | null;
  daysSinceLastPost: number | null;
  /** heatmap[weekday][hour] = posts, weekday 0 = Monday, in the requested time zone. */
  heatmap: number[][];
  bestSlots: SlotCount[];
  timeZone: string;
}

export interface Summary {
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface PostRef {
  id: string;
  shortcode: string | null;
  postedAt: string;
  interactions: number;
  /** First 120 characters of the caption. */
  captionStart: string | null;
}

export interface Engagement {
  /** Posts with both likes and comments known. */
  postsWithMetrics: number;
  likes: Summary | null;
  comments: Summary | null;
  interactions: Summary | null;
  /** Mean (likes+comments) / followers * 100, null without followers or metrics. */
  ratePct: number | null;
  medianRatePct: number | null;
  top: PostRef[];
  bottom: PostRef[];
}

export interface CaptionStats {
  postsWithCaption: number;
  avgLength: number | null;
  medianLength: number | null;
  /** 0..1 of captions with a call to action (Italian and English phrases). */
  ctaShare: number | null;
  questionShare: number | null;
  emojiShare: number | null;
  avgEmojis: number | null;
  language: "it" | "en" | "mixed" | "unknown";
}

export interface Ranked {
  handle: Handle;
  count: number;
}

export interface Tagging {
  /** Accounts the profile tags in its media. */
  tagged: Ranked[];
  /** Accounts written as @mention in captions. */
  mentioned: Ranked[];
  collaborators: Ranked[];
}

export interface ProfileAnalysis {
  handle: Handle;
  basis: Basis;
  followers: number | null;
  mix: ContentMix;
  hashtags: HashtagStats;
  cadence: Cadence;
  engagement: Engagement;
  captions: CaptionStats;
  tagging: Tagging;
}
