/** Shade of a heatmap cell, 0 (no posts) to 4 (the busiest slot). */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(count: number, max: number): HeatLevel {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as HeatLevel;
}

/** Token classes per level; full strings so Tailwind finds them. */
export const heatClass: Record<HeatLevel, string> = {
  0: "bg-app",
  1: "bg-primary/20",
  2: "bg-primary/40",
  3: "bg-primary/70",
  4: "bg-primary",
};

export const heatmapMax = (heatmap: number[][]): number =>
  Math.max(0, ...heatmap.map((row) => Math.max(0, ...row)));

/** Weekday names in the order of `Cadence.heatmap` (0 = Monday). */
export const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
