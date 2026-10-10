import type { Format } from "@forgecy/i18n";
import type { BenchmarkMetric } from "@forgecy/social";

/** How a benchmark metric is written: a share (0..1), a rate already in %, or a plain number. */
const KIND: Record<BenchmarkMetric, "share" | "rate" | "count" | "decimal"> = {
  followers: "count",
  postsPerWeek: "decimal",
  engagementRatePct: "rate",
  avgHashtagsPerPost: "decimal",
  ctaShare: "share",
  reelShare: "share",
  carouselShare: "share",
  sponsoredShare: "share",
  daysSinceLastPost: "count",
};

export function formatMetric(format: Format, metric: BenchmarkMetric, value: number): string {
  switch (KIND[metric]) {
    case "share":
      return format.percent(value);
    case "rate":
      return `${format.number(value, { maximumFractionDigits: 2 })}%`;
    case "decimal":
      return format.number(value, { maximumFractionDigits: 1 });
    case "count":
      return format.number(value, { maximumFractionDigits: 0 });
  }
}

/** Signed difference from our profile. `points` means percentage points (the caller adds the unit). */
export function formatDelta(
  format: Format,
  metric: BenchmarkMetric,
  delta: number,
): { value: string; points: boolean } {
  const kind = KIND[metric];
  const points = kind === "share" || kind === "rate";
  const scaled = kind === "share" ? delta * 100 : delta;
  const digits = kind === "count" ? 0 : kind === "decimal" ? 1 : kind === "share" ? 0 : 2;
  return {
    value: format.number(scaled, { maximumFractionDigits: digits, signDisplay: "exceptZero" }),
    points,
  };
}
