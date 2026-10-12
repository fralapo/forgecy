import type { ProfileData } from "../types";
import { cadence } from "./cadence";
import { captionStats } from "./captions";
import { engagement } from "./engagement";
import { hashtagStats } from "./hashtags";
import { contentMix } from "./mix";
import { tagging } from "./tagging";
import type { ProfileAnalysis } from "./types";

export function analyzeProfile(
  data: ProfileData,
  opts: { timeZone?: string; now?: Date; topN?: number } = {},
): ProfileAnalysis {
  const { profile, posts } = data;
  const times = posts.map((p) => p.postedAt).sort((a, b) => Date.parse(a) - Date.parse(b));

  return {
    handle: profile.handle,
    basis: {
      postsUsed: posts.length,
      from: times[0] ?? null,
      to: times[times.length - 1] ?? null,
      source: profile.source,
      observedAt: profile.observedAt,
    },
    followers: profile.followers,
    mix: contentMix(posts),
    hashtags: hashtagStats(posts, opts.topN),
    cadence: cadence(posts, { timeZone: opts.timeZone ?? "UTC", now: opts.now ?? new Date() }),
    engagement: engagement(posts, profile.followers),
    captions: captionStats(posts),
    tagging: tagging(posts, opts.topN),
  };
}
