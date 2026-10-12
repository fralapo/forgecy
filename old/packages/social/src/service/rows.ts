import type { socialPosts, socialProfiles } from "@forgecy/db";
import type { MediaKind, PostSnapshot, ProfileSnapshot, SnapshotSource } from "../types";

export type ProfileRow = typeof socialProfiles.$inferSelect;
export type PostRow = typeof socialPosts.$inferSelect;
export type PostInsert = typeof socialPosts.$inferInsert;

export const SNAPSHOT_SCHEMA_VERSION = 1;
/** Instagram allows 2,200 characters; anything much longer is not a caption. */
const MAX_CAPTION = 5_000;

export function postFromRow(row: PostRow): PostSnapshot {
  return {
    id: row.postId,
    shortcode: row.shortcode,
    postedAt: row.postedAt.toISOString(),
    kind: row.kind as MediaKind,
    caption: row.caption,
    likes: row.likes,
    comments: row.comments,
    views: row.views,
    hashtags: row.hashtags,
    mentions: row.mentions,
    taggedAccounts: row.taggedAccounts,
    collaborators: row.collaborators,
    location: row.location,
    isSponsored: row.isSponsored,
    isPinned: row.isPinned,
    carouselCount: row.carouselCount,
    accessibilityCaption: row.accessibilityCaption,
  };
}

export function postToInsert(
  profileId: string,
  post: PostSnapshot,
  source: SnapshotSource,
  now: Date,
): PostInsert {
  return {
    profileId,
    postId: post.id,
    shortcode: post.shortcode,
    postedAt: new Date(post.postedAt),
    kind: post.kind,
    caption: post.caption ? post.caption.slice(0, MAX_CAPTION) : null,
    likes: post.likes,
    comments: post.comments,
    views: post.views,
    hashtags: post.hashtags,
    mentions: post.mentions,
    taggedAccounts: post.taggedAccounts,
    collaborators: post.collaborators,
    location: post.location,
    isSponsored: post.isSponsored,
    isPinned: post.isPinned,
    carouselCount: post.carouselCount,
    accessibilityCaption: post.accessibilityCaption,
    source,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

/** A stored snapshot is JSON of a ProfileSnapshot; this is the one place that trusts its shape. */
export function profileFromJson(json: Record<string, unknown>): ProfileSnapshot {
  return json as unknown as ProfileSnapshot;
}
