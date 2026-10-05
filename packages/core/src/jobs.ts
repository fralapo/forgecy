/** Persistent job states (spec: "Stato dei job"). The UI reads only these, never file presence. */
export const jobStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "retrying",
  "cancelled",
  "needs_attention",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled", "needs_attention"]);

/** Max attempts and backoff from the spec: immediately, after 5 s, after 30 s. */
export const JOB_MAX_ATTEMPTS = 3;
export const JOB_BACKOFF_MS = [0, 5_000, 30_000] as const;
/** Lock TTL used to recover jobs left hanging after a worker crash. */
export const JOB_LOCK_TTL_MS = 10 * 60 * 1000;
