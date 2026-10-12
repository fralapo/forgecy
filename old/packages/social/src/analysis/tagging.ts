import type { PostSnapshot } from "../types";
import type { Ranked, Tagging } from "./types";

function rank(lists: string[][], topN: number): Ranked[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    // A handle counts once per post.
    for (const handle of new Set(list)) counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([handle, count]) => ({ handle, count }))
    .sort((a, b) => b.count - a.count || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
    .slice(0, topN);
}

export function tagging(posts: PostSnapshot[], topN = 10): Tagging {
  return {
    tagged: rank(
      posts.map((p) => p.taggedAccounts),
      topN,
    ),
    mentioned: rank(
      posts.map((p) => p.mentions),
      topN,
    ),
    collaborators: rank(
      posts.map((p) => p.collaborators),
      topN,
    ),
  };
}
