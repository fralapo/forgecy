import type { PostSnapshot } from "../types";
import type { Engagement, PostRef, Summary } from "./types";

/** likes + comments, defined only when both are known. */
export function interactionsOf(post: PostSnapshot): number | null {
  return post.likes === null || post.comments === null ? null : post.likes + post.comments;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function summary(values: number[]): Summary | null {
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: mean(values)!,
    median: median(values)!,
  };
}

function ref(post: PostSnapshot, interactions: number): PostRef {
  return {
    id: post.id,
    shortcode: post.shortcode,
    postedAt: post.postedAt,
    interactions,
    captionStart: post.caption === null ? null : post.caption.slice(0, 120),
  };
}

export function engagement(posts: PostSnapshot[], followers: number | null, topN = 3): Engagement {
  const withMetrics: { post: PostSnapshot; interactions: number }[] = [];
  for (const post of posts) {
    const interactions = interactionsOf(post);
    if (interactions !== null) withMetrics.push({ post, interactions });
  }
  const interactions = withMetrics.map((m) => m.interactions);
  const interactionSummary = summary(interactions);

  const rate = (value: number | undefined): number | null =>
    value === undefined || followers === null || followers === 0 ? null : (value / followers) * 100;

  // Ties: newer post first.
  const newerFirst = (a: PostSnapshot, b: PostSnapshot) =>
    Date.parse(b.postedAt) - Date.parse(a.postedAt);
  const desc = [...withMetrics].sort(
    (a, b) => b.interactions - a.interactions || newerFirst(a.post, b.post),
  );
  const asc = [...withMetrics].sort(
    (a, b) => a.interactions - b.interactions || newerFirst(a.post, b.post),
  );

  return {
    postsWithMetrics: withMetrics.length,
    likes: summary(withMetrics.map((m) => m.post.likes!)),
    comments: summary(withMetrics.map((m) => m.post.comments!)),
    interactions: interactionSummary,
    ratePct: rate(interactionSummary?.mean),
    medianRatePct: rate(interactionSummary?.median),
    top: desc.slice(0, topN).map((m) => ref(m.post, m.interactions)),
    bottom: asc.slice(0, topN).map((m) => ref(m.post, m.interactions)),
  };
}
