import type { PostSnapshot } from "../types";
import { interactionsOf, mean } from "./engagement";
import type { HashtagStats } from "./types";

export function hashtagStats(posts: PostSnapshot[], topN = 15): HashtagStats {
  // tag -> interactions of the posts using it (null entries skipped later)
  const byTag = new Map<string, (number | null)[]>();
  let totalTags = 0;
  let postsWithHashtags = 0;

  for (const post of posts) {
    totalTags += post.hashtags.length;
    if (post.hashtags.length > 0) postsWithHashtags += 1;
    const interactions = interactionsOf(post);
    // A tag counts once per post.
    for (const tag of new Set(post.hashtags)) {
      const list = byTag.get(tag);
      if (list) list.push(interactions);
      else byTag.set(tag, [interactions]);
    }
  }

  const top = [...byTag.entries()]
    .map(([tag, list]) => ({
      tag,
      count: list.length,
      avgInteractions: mean(list.filter((v): v is number => v !== null)),
    }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, topN);

  return {
    postsWithHashtags,
    avgPerPost: posts.length === 0 ? null : totalTags / posts.length,
    distinct: byTag.size,
    top,
  };
}
