import {
  canViewJob,
  TERMINAL_JOB_STATUSES,
  type Actor,
  type JobStatus,
  type MessageRef,
} from "@forgecy/core";
import { eq, jobs, type Database } from "@forgecy/db";

export interface JobEvent {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  attempts: number;
  error: string | null;
  /** Translatable form of `error`; the interface prefers it when present. */
  errorRef: MessageRef | null;
  result: Record<string, unknown> | null;
  updatedAt: Date;
  terminal: boolean;
}

export interface SubscribeOptions {
  intervalMs?: number;
  /** Abort when the HTTP client disconnects. */
  signal?: AbortSignal;
}

/**
 * Whether `actor` may watch this job. A missing job answers false too, so the route can
 * return the same 404 for "no such job" and "not yours": an id alone confirms nothing.
 */
export async function jobVisibleTo(db: Database, actor: Actor, jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ kind: jobs.kind, clientId: jobs.clientId })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  return !!row && canViewJob(actor, row);
}

/**
 * Async iterator of job state for the web SSE route (`GET /api/jobs/:id/events`).
 * Polls the jobs row (Postgres is the source of truth, see spec "Job status") and
 * yields on every change until a terminal status, abort, or the row disappears.
 */
export async function* subscribeJobEvents(
  db: Database,
  jobId: string,
  options: SubscribeOptions = {},
): AsyncGenerator<JobEvent, void, undefined> {
  const interval = options.intervalMs ?? 1000;
  let lastKey = "";
  while (!options.signal?.aborted) {
    const [row] = await db
      .select({
        id: jobs.id,
        kind: jobs.kind,
        status: jobs.status,
        progress: jobs.progress,
        attempts: jobs.attempts,
        error: jobs.error,
        errorRef: jobs.errorRef,
        result: jobs.result,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    if (!row) return;
    const terminal = TERMINAL_JOB_STATUSES.has(row.status);
    const key = `${row.status}|${row.progress}|${row.attempts}|${row.error ?? ""}`;
    if (key !== lastKey) {
      lastKey = key;
      yield { ...row, result: terminal ? row.result : null, terminal };
    }
    if (terminal) return;
    await sleep(interval, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
