import { JOB_BACKOFF_MS, JOB_MAX_ATTEMPTS } from "@forgecy/core";

/** Name of the custom BullMQ backoff strategy registered by the worker. */
export const FORGECY_BACKOFF = "forgecy";

/**
 * Spec: attempt 1 immediately, attempt 2 after 5 s, attempt 3 after 30 s.
 * BullMQ passes the number of failed attempts so far (1 after the first failure).
 */
export function forgecyBackoff(attemptsMade: number): number {
  const delays = JOB_BACKOFF_MS;
  return (
    delays[Math.min(Math.max(attemptsMade, 1), delays.length - 1)] ?? delays[delays.length - 1]!
  );
}

export const defaultJobOptions = {
  attempts: JOB_MAX_ATTEMPTS,
  backoff: { type: FORGECY_BACKOFF },
  // Postgres holds the durable state; Redis keeps only a short tail for debugging.
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
} as const;
