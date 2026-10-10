import type { PostSnapshot, ProfileData, ProfileSnapshot } from "./types";

export const changeEventTypes = [
  "followers",
  "following",
  "posts_total",
  "biography",
  "external_url",
  "full_name",
  "category",
  "visibility",
  "picture",
  "new_post",
  "source",
] as const;
export type ChangeEventType = (typeof changeEventTypes)[number];

export interface ChangeEvent {
  type: ChangeEventType;
  old: string | null;
  new: string | null;
  postId?: string;
}

const num = (n: number | null): string | null => (n === null ? null : String(n));
const vis = (p: boolean | null): string | null => (p === null ? null : p ? "private" : "public");

function ms(iso: string): number {
  return Date.parse(iso);
}

/** First snapshot is a baseline: no events. Never reads observedAt. */
export function diffProfiles(prev: ProfileData | null, next: ProfileData): ChangeEvent[] {
  if (!prev) return [];
  const a = prev.profile;
  const b = next.profile;
  const events: ChangeEvent[] = [];
  const push = (type: ChangeEventType, o: string | null, n: string | null): void => {
    if (o !== n) events.push({ type, old: o, new: n });
  };

  push("followers", num(a.followers), num(b.followers));
  push("following", num(a.following), num(b.following));
  push("posts_total", num(a.postsTotal), num(b.postsTotal));
  push("biography", a.biography, b.biography);
  push("external_url", a.externalUrl, b.externalUrl);
  push("full_name", a.fullName, b.fullName);
  push("category", a.category, b.category);
  push("visibility", vis(a.isPrivate), vis(b.isPrivate));
  if (a.pictureHash !== null && b.pictureHash !== null) {
    push("picture", a.pictureHash, b.pictureHash);
  }
  events.push(...newPostEvents(prev.posts, next.posts));
  push("source", a.source, b.source);
  return events;
}

function newPostEvents(prev: PostSnapshot[], next: PostSnapshot[]): ChangeEvent[] {
  // Without previous posts there is no cutoff: the snapshot was cheap-first, not empty.
  if (prev.length === 0) return [];
  const known = new Set(prev.map((p) => p.id));
  const newest = Math.max(...prev.map((p) => ms(p.postedAt)));
  return next
    .filter((p) => !known.has(p.id) && ms(p.postedAt) > newest)
    .sort((x, y) => ms(x.postedAt) - ms(y.postedAt))
    .map((p) => ({ type: "new_post", old: null, new: p.shortcode ?? p.id, postId: p.id }));
}

/** Cheap-first: the post list is only worth fetching when the total moved or is unknown. */
export function needsPostFetch(prev: ProfileSnapshot | null, next: ProfileSnapshot): boolean {
  if (!prev) return true;
  if (prev.postsTotal === null || next.postsTotal === null) return true;
  return prev.postsTotal !== next.postsTotal;
}
