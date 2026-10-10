/** Which message of `social.cards.events` tells one change-log entry. */
export type EventKey =
  | "followers"
  | "following"
  | "posts_total"
  | "biography.changed"
  | "biography.added"
  | "biography.removed"
  | "external_url.changed"
  | "external_url.added"
  | "external_url.removed"
  | "full_name.changed"
  | "full_name.added"
  | "full_name.removed"
  | "category.changed"
  | "category.added"
  | "category.removed"
  | "visibility.private"
  | "visibility.public"
  | "picture"
  | "new_post"
  | "source"
  | "other";

export interface EventLike {
  type: string;
  old: string | null;
  new: string | null;
}

const NUMERIC = new Set(["followers", "following", "posts_total"]);
const TEXT = ["biography", "external_url", "full_name", "category"] as const;

export function describeEvent(e: EventLike): { key: EventKey; numeric: boolean } {
  if (NUMERIC.has(e.type)) return { key: e.type as EventKey, numeric: true };
  const text = TEXT.find((t) => t === e.type);
  if (text) {
    const how = e.old === null ? "added" : e.new === null ? "removed" : "changed";
    return { key: `${text}.${how}`, numeric: false };
  }
  if (e.type === "visibility")
    return {
      key: e.new === "private" ? "visibility.private" : "visibility.public",
      numeric: false,
    };
  if (e.type === "picture" || e.type === "new_post" || e.type === "source")
    return { key: e.type, numeric: false };
  return { key: "other", numeric: false };
}

/** Instagram post link, only for a real shortcode (a bare media id has none). */
export function postUrl(shortcode: string | null): string | null {
  return shortcode && /^[A-Za-z0-9_-]{5,}$/.test(shortcode) && !/^\d+$/.test(shortcode)
    ? `https://www.instagram.com/p/${shortcode}/`
    : null;
}

export const profileUrl = (handle: string): string => `https://www.instagram.com/${handle}/`;
