/**
 * The visual review goes one atomic fix per round: fix the first note, look again. After this
 * many rounds the review stops and a person decides whether the slides are good enough.
 */
export const MAX_VISUAL_ROUNDS = 3;

/**
 * Round number of the next review, or `null` when the rounds are used up. A review with no
 * notes (a pass) or an explicit restart opens a new series at round 1.
 */
export function nextVisualRound(
  previous: { round: number; notes: number } | null,
  restart = false,
): number | null {
  if (!previous || restart || previous.notes === 0) return 1;
  return previous.round >= MAX_VISUAL_ROUNDS ? null : previous.round + 1;
}

/** Notes in slide order (the first one is the next fix); notes of one slide keep the reviewer's order. */
export function orderVisualNotes<T extends { slide: number }>(notes: readonly T[]): T[] {
  return notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.slide - b.n.slide || a.i - b.i)
    .map((x) => x.n);
}
