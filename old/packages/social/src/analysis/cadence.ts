import type { PostSnapshot } from "../types";
import { median } from "./engagement";
import type { Cadence, SlotCount } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function cadence(posts: PostSnapshot[], opts: { timeZone: string; now: Date }): Cadence {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: opts.timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  });

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const times: { ms: number; iso: string }[] = [];
  for (const post of posts) {
    const ms = Date.parse(post.postedAt);
    if (Number.isNaN(ms)) continue;
    times.push({ ms, iso: post.postedAt });
    // A day-precision time (noon) says nothing about the hour of the day.
    if (post.postedAtPrecision === "day") continue;
    const parts = fmt.formatToParts(ms);
    const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")!.value);
    const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
    heatmap[weekday]![hour]! += 1;
  }

  const slots: SlotCount[] = [];
  heatmap.forEach((row, weekday) =>
    row.forEach((count, hour) => {
      if (count > 0) slots.push({ weekday, hour, count });
    }),
  );
  const bestSlots = slots
    .sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, 5);

  times.sort((a, b) => b.ms - a.ms); // newest first
  const newest = times[0];
  const oldest = times[times.length - 1];

  let postsPerWeek: number | null = null;
  let medianGapHours: number | null = null;
  if (newest && oldest && times.length >= 2) {
    const spanDays = Math.max(7, (newest.ms - oldest.ms) / DAY_MS);
    postsPerWeek = ((times.length - 1) / spanDays) * 7;
    const gaps = times.slice(1).map((t, i) => (times[i]!.ms - t.ms) / HOUR_MS);
    medianGapHours = median(gaps);
  }

  return {
    postsPerWeek,
    medianGapHours,
    lastPostAt: newest?.iso ?? null,
    daysSinceLastPost: newest
      ? Math.max(0, Math.floor((opts.now.getTime() - newest.ms) / DAY_MS))
      : null,
    heatmap,
    bestSlots,
    timeZone: opts.timeZone,
  };
}
