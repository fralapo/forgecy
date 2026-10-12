import { JOB_LOCK_TTL_MS, JOB_MAX_ATTEMPTS } from "@forgecy/core";
import { and, eq, inArray, jobs, lt, type Database } from "@forgecy/db";
import { englishMessage, messageRef } from "@forgecy/i18n";
import type { Queue } from "bullmq";
import type { BullJobData, JobQueues } from "./queues";
import { jobDefinitions } from "./registry";

/**
 * A `queued`/`retrying` row this old with no BullMQ job is an orphan, not an enqueue in
 * flight (enqueueJob inserts the row, then calls queue.add a few ms later).
 */
export const ORPHAN_GRACE_MS = 2 * 60 * 1000;
const ORPHAN_BATCH = 200;

export interface RecoveryResult {
  /** Stale `running` rows put back to `retrying`. */
  retried: string[];
  /** Stale `running` rows out of attempts, now `failed`. */
  failed: string[];
  /** Rows whose BullMQ job was gone and was added again. */
  requeued: string[];
}

export interface RecoveryOptions {
  /** Required: without it a recovered row would stay `retrying` forever. */
  queues: JobQueues;
  maxAttempts?: number;
  orphanGraceMs?: number;
}

type Requeueable = { id: string; kind: string; attempts: number };

/**
 * Make sure BullMQ has a job for this row. A job that is waiting, delayed, active or
 * prioritized is left alone; a missing job is added; a completed/failed one is removed
 * first because BullMQ silently ignores `add` with an existing jobId. Idempotent, so two
 * workers running recovery at once end with one job (jobId = row id).
 */
export async function ensureQueued(
  queue: Pick<Queue<BullJobData>, "getJob" | "add">,
  row: Requeueable,
  maxAttempts: number,
): Promise<boolean> {
  const existing = await queue.getJob(row.id);
  const state = existing ? await existing.getState() : "unknown";
  if (state !== "completed" && state !== "failed" && state !== "unknown") return false;
  await existing?.remove().catch(() => undefined);
  await queue.add(
    row.kind,
    { kind: row.kind },
    { jobId: row.id, attempts: Math.max(1, maxAttempts - row.attempts) },
  );
  return true;
}

/**
 * Crash recovery, in two passes:
 * 1. rows stuck in `running` with no update for `olderThanMs` (default: lock TTL, 10 min) go
 *    back to `retrying` if attempts remain, else `failed`. The write is a compare-and-set on
 *    status and age, so a job that just resumed is never touched.
 * 2. rows in `queued`/`retrying` older than `orphanGraceMs` whose BullMQ job is gone (crash
 *    between INSERT and queue.add, Redis wiped, stalled-too-often failure) are added again.
 * Run it at worker startup and periodically.
 */
export async function recoverStaleJobs(
  db: Database,
  olderThanMs: number,
  options: RecoveryOptions,
): Promise<RecoveryResult> {
  const { queues } = options;
  const maxAttempts = options.maxAttempts ?? JOB_MAX_ATTEMPTS;
  const cutoff = new Date(Date.now() - (olderThanMs || JOB_LOCK_TTL_MS));
  const result: RecoveryResult = { retried: [], failed: [], requeued: [] };

  const requeue = async (row: Requeueable) => {
    const def = jobDefinitions.get(row.kind);
    // A kind this process does not know cannot be routed to a queue; another worker may.
    return def ? ensureQueued(queues.get(def.queue), row, maxAttempts) : false;
  };

  const stale = await db
    .select({ id: jobs.id, kind: jobs.kind, attempts: jobs.attempts })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, cutoff)));

  for (const row of stale) {
    const retry = row.attempts < maxAttempts;
    const [updated] = await db
      .update(jobs)
      .set(
        retry
          ? {
              status: "retrying",
              error: englishMessage("jobs.errors.interruptedRetrying"),
              errorRef: messageRef("jobs.errors.interruptedRetrying"),
            }
          : {
              status: "failed",
              error: englishMessage("jobs.errors.interruptedFinal"),
              errorRef: messageRef("jobs.errors.interruptedFinal"),
              endedAt: new Date(),
            },
      )
      // Re-check status + attempt + age so a job that just resumed isn't touched.
      .where(
        and(
          eq(jobs.id, row.id),
          eq(jobs.status, "running"),
          eq(jobs.attempts, row.attempts),
          lt(jobs.updatedAt, cutoff),
        ),
      )
      .returning({ id: jobs.id });
    if (!updated) continue;
    (retry ? result.retried : result.failed).push(row.id);
    if (retry) await requeue(row);
  }

  const orphanCutoff = new Date(Date.now() - (options.orphanGraceMs ?? ORPHAN_GRACE_MS));
  const orphans = await db
    .select({ id: jobs.id, kind: jobs.kind, attempts: jobs.attempts })
    .from(jobs)
    .where(and(inArray(jobs.status, ["queued", "retrying"]), lt(jobs.updatedAt, orphanCutoff)))
    .limit(ORPHAN_BATCH);
  for (const row of orphans) {
    if (await requeue(row)) result.requeued.push(row.id);
  }
  return result;
}
