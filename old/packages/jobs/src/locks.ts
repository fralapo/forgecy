import { JOB_LOCK_TTL_MS } from "@forgecy/core";
import { sql, type Database } from "@forgecy/db";

/**
 * Content lock (spec "Content lock"): columns `locked_by_job_id` (uuid) and
 * `lock_expires_at` (timestamptz) on the target table. Acquire is a single conditional
 * UPDATE, so two jobs can never hold the same row.
 */
export interface LockTarget {
  /** Table name, e.g. "contents". Validated as a plain identifier. */
  table: string;
  id: string;
  jobId: string;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

function tableRef(name: string) {
  if (!IDENT.test(name)) throw new Error(`Invalid table name "${name}"`);
  return sql.identifier(name);
}

type Executor = Pick<Database, "execute">;

function affected(res: unknown): number {
  return (res as { rowCount?: number | null }).rowCount ?? 0;
}

/** Take the lock if free, expired, or already ours. Returns false when another job holds it. */
export async function acquireLock(
  db: Executor,
  opts: LockTarget & { ttlMs?: number },
): Promise<boolean> {
  const ttl = Math.round(opts.ttlMs ?? JOB_LOCK_TTL_MS);
  const res = await db.execute(sql`
    update ${tableRef(opts.table)}
    set locked_by_job_id = ${opts.jobId}, lock_expires_at = now() + (${ttl}::int * interval '1 millisecond')
    where id = ${opts.id}
      and (locked_by_job_id is null or lock_expires_at < now() or locked_by_job_id = ${opts.jobId})`);
  return affected(res) === 1;
}

/** Extend our lock. False means it expired and someone else took it: stop working. */
export async function renewLock(
  db: Executor,
  opts: LockTarget & { ttlMs?: number },
): Promise<boolean> {
  const ttl = Math.round(opts.ttlMs ?? JOB_LOCK_TTL_MS);
  const res = await db.execute(sql`
    update ${tableRef(opts.table)}
    set lock_expires_at = now() + (${ttl}::int * interval '1 millisecond')
    where id = ${opts.id} and locked_by_job_id = ${opts.jobId}`);
  return affected(res) === 1;
}

/** Release our lock (no-op if we no longer hold it). */
export async function releaseLock(db: Executor, opts: LockTarget): Promise<boolean> {
  const res = await db.execute(sql`
    update ${tableRef(opts.table)}
    set locked_by_job_id = null, lock_expires_at = null
    where id = ${opts.id} and locked_by_job_id = ${opts.jobId}`);
  return affected(res) === 1;
}

export class LockUnavailableError extends Error {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`Content locked by another job (${table}/${id})`);
    this.name = "LockUnavailableError";
  }
}

/**
 * Acquire, renew every ttl/3 while `fn` runs, and always release (also on error).
 * Throws LockUnavailableError when the row is locked by another job.
 */
export async function withLock<T>(
  db: Executor,
  opts: LockTarget & { ttlMs?: number },
  fn: (lost: () => boolean) => Promise<T>,
): Promise<T> {
  const ttl = opts.ttlMs ?? JOB_LOCK_TTL_MS;
  if (!(await acquireLock(db, opts))) throw new LockUnavailableError(opts.table, opts.id);
  let lost = false;
  const timer = setInterval(
    () => {
      renewLock(db, opts).then(
        (ok) => {
          if (!ok) lost = true;
        },
        () => undefined,
      );
    },
    Math.max(1000, Math.floor(ttl / 3)),
  );
  timer.unref();
  try {
    return await fn(() => lost);
  } finally {
    clearInterval(timer);
    await releaseLock(db, opts);
  }
}
