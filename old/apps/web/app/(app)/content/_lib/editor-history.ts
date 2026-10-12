/**
 * Undo/redo of the draft document in the editor: a pure reducer over snapshots, kept in the
 * editor state only (never saved, cleared whenever the draft is reloaded from the server).
 * Undoing does not touch the saved revision: it is an ordinary edit that the autosave sends.
 */
export const HISTORY_LIMIT = 30;
/** Edits closer than this (typing in one field) share one undo step. */
export const COALESCE_MS = 800;

export interface History<T> {
  /** Oldest first; the last entry is the state an undo goes back to. */
  past: T[];
  future: T[];
  /** Time of the last recorded edit, to group quick consecutive edits. */
  at: number;
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [], at: 0 });

/** An edit is about to replace `before`: remember it, unless it continues the previous edit. */
export function record<T>(h: History<T>, before: T, now: number): History<T> {
  const continues = h.past.length > 0 && now - h.at < COALESCE_MS && h.future.length === 0;
  if (continues) return { ...h, at: now };
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [], at: now };
}

export interface Step<T> {
  history: History<T>;
  /** The document to show. */
  present: T;
}

/** Go back one step from `present`, or null when there is nothing to undo. */
export function undo<T>(h: History<T>, present: T): Step<T> | null {
  const previous = h.past.at(-1);
  if (previous === undefined) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [present, ...h.future], at: 0 },
    present: previous,
  };
}

/** Go forward one step from `present`, or null when there is nothing to redo. */
export function redo<T>(h: History<T>, present: T): Step<T> | null {
  const next = h.future[0];
  if (next === undefined) return null;
  return {
    history: { past: [...h.past, present].slice(-HISTORY_LIMIT), future: h.future.slice(1), at: 0 },
    present: next,
  };
}
