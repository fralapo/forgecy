import { JOB_LOCK_TTL_MS, JOB_MAX_ATTEMPTS } from "@forgecy/core";
import { and, eq, jobs, lt, type Database } from "@forgecy/db";
import { jobDefinitions } from "./registry";
import type { JobQueues } from "./queues";

export interface RecoveryResult {
  retried: string[];
  failed: string[];
}

/**
 * Crash recovery: rows stuck in `running` with no update for `olderThanMs` (default:
 * lock TTL, 10 min) go back to `retrying` if attempts remain, else `failed`.
 * With `queues`, retried rows whose BullMQ job is gone are re-added to Redis.
 * Run it at worker startup and periodically (e.g. every 5 min).
 */
export async function recoverStaleJobs(
  db: Database,
  olderThanMs: number = JOB_LOCK_TTL_MS,
  options: { queues?: JobQueues; maxAttempts?: number } = {},
): Promise<RecoveryResult> {
  const maxAttempts = options.maxAttempts ?? JOB_MAX_ATTEMPTS;
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ id: jobs.id, kind: jobs.kind, attempts: jobs.attempts })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, cutoff)));

  const result: RecoveryResult = { retried: [], failed: [] };
  for (const row of stale) {
    const retry = row.attempts < maxAttempts;
    const [updated] = await db
      .update(jobs)
      .set(
        retry
          ? { status: "retrying", error: "Worker interrotto: nuovo tentativo" }
          : {
              status: "failed",
              error: "Worker interrotto dopo l'ultimo tentativo",
              endedAt: new Date(),
            },
      )
      // Re-check status + age so a job that just resumed isn't touched.
      .where(and(eq(jobs.id, row.id), eq(jobs.status, "running"), lt(jobs.updatedAt, cutoff)))
      .returning({ id: jobs.id });
    if (!updated) continue;
    (retry ? result.retried : result.failed).push(row.id);

    const def = jobDefinitions.get(row.kind);
    if (retry && options.queues && def) {
      const queue = options.queues.get(def.queue);
      const existing = await queue.getJob(row.id);
      const state = existing ? await existing.getState() : "unknown";
      if (state === "completed" || state === "failed" || state === "unknown") {
        await existing?.remove().catch(() => undefined);
        await queue.add(
          def.kind,
          { kind: def.kind },
          { jobId: row.id, attempts: Math.max(1, maxAttempts - row.attempts) },
        );
      }
    }
  }
  return result;
}
