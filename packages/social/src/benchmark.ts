import type { ProfileAnalysis } from "./analysis/types";
import type { Handle } from "./types";

export type BenchmarkRole = "self" | "competitor" | "prospect";

export interface BenchmarkEntry {
  handle: Handle;
  role: BenchmarkRole;
  analysis: ProfileAnalysis;
}

export const benchmarkMetrics = [
  "followers",
  "postsPerWeek",
  "engagementRatePct",
  "avgHashtagsPerPost",
  "ctaShare",
  "reelShare",
  "carouselShare",
  "sponsoredShare",
  "daysSinceLastPost",
] as const;
export type BenchmarkMetric = (typeof benchmarkMetrics)[number];

export interface BenchmarkRow {
  handle: Handle;
  role: BenchmarkRole;
  values: Record<BenchmarkMetric, number | null>;
  /** 1 = best; ties share a rank. */
  ranks: Record<BenchmarkMetric, number | null>;
  /** value - self value; null when either is null or there is no self. */
  vsSelf: Record<BenchmarkMetric, number | null>;
}

export interface BenchmarkTable {
  rows: BenchmarkRow[];
  best: Record<BenchmarkMetric, Handle | null>;
  /** Mixed sources, or post windows ending more than 30 days apart. */
  basisWarning: boolean;
}

const DAY_MS = 86_400_000;

const lowerIsBetter: ReadonlySet<BenchmarkMetric> = new Set(["daysSinceLastPost"]);

function valuesOf(a: ProfileAnalysis): Record<BenchmarkMetric, number | null> {
  return {
    followers: a.followers,
    postsPerWeek: a.cadence.postsPerWeek,
    engagementRatePct: a.engagement.ratePct,
    avgHashtagsPerPost: a.hashtags.avgPerPost,
    ctaShare: a.captions.ctaShare,
    reelShare: a.mix.byKind.reel.share,
    carouselShare: a.mix.byKind.carousel.share,
    sponsoredShare: a.mix.sponsoredShare,
    daysSinceLastPost: a.cadence.daysSinceLastPost,
  };
}

function perMetric<T>(fn: (m: BenchmarkMetric) => T): Record<BenchmarkMetric, T> {
  return Object.fromEntries(benchmarkMetrics.map((m) => [m, fn(m)])) as Record<BenchmarkMetric, T>;
}

export function buildBenchmark(entries: BenchmarkEntry[]): BenchmarkTable {
  const values = entries.map((e) => valuesOf(e.analysis));
  const self = values[entries.findIndex((e) => e.role === "self")];

  // Standard competition ranking: 1,1,3.
  const ranksFor = (m: BenchmarkMetric): (number | null)[] => {
    const sign = lowerIsBetter.has(m) ? 1 : -1;
    const present = values.flatMap((v) => (v[m] === null ? [] : [v[m] as number]));
    return values.map((v) => {
      const x = v[m];
      if (x === null) return null;
      return 1 + present.filter((p) => sign * (p - x) < 0).length;
    });
  };
  const ranks = perMetric(ranksFor);

  const rows = entries.map((e, i): BenchmarkRow => {
    const v = values[i] as Record<BenchmarkMetric, number | null>;
    return {
      handle: e.handle,
      role: e.role,
      values: v,
      ranks: perMetric((m) => ranks[m][i] ?? null),
      vsSelf: perMetric((m) => {
        const mine = self?.[m] ?? null;
        return v[m] === null || mine === null ? null : (v[m] as number) - mine;
      }),
    };
  });

  const best = perMetric((m) => {
    const i = ranks[m].indexOf(1);
    return i < 0 ? null : (entries[i]?.handle ?? null);
  });

  const ends = entries.flatMap((e) =>
    e.analysis.basis.to ? [Date.parse(e.analysis.basis.to)] : [],
  );
  const basisWarning =
    new Set(entries.map((e) => e.analysis.basis.source)).size > 1 ||
    (ends.length > 1 && Math.max(...ends) - Math.min(...ends) > 30 * DAY_MS);

  return { rows, best, basisWarning };
}
