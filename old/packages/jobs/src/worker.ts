import { UnrecoverableError, Worker, type Job } from "bullmq";
import { JOB_HEARTBEAT_MS, JOB_MAX_ATTEMPTS, messageRefOf } from "@forgecy/core";
import { and, eq, inArray, jobs, sql, type Database } from "@forgecy/db";
import type { z } from "zod";
import { FORGECY_BACKOFF, forgecyBackoff } from "./backoff";
import { errorMessage, isNeedsAttentionError, isUnrecoverableError } from "./errors";
import { startHeartbeat } from "./heartbeat";
import { QUEUE_PREFIX, type BullJobData, type JobRow } from "./queues";
import {
  jobDefinitions,
  type AnyJobDefinition,
  type JobDefinition,
  type JobQueueName,
} from "./registry";
import { closeRedisConnection, createRedisConnection, type RedisConnection } from "./redis";

export interface JobLogger {
  debug?(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface JobContext {
  jobId: string;
  kind: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
  row: JobRow;
  db: Database;
  logger: JobLogger;
  /** Report progress 0–100 (persisted; the UI reads it via SSE). */
  progress(percent: number): Promise<void>;
  /** Touch updated_at now. The worker also does this every JOB_HEARTBEAT_MS while the handler runs; call it yourself only for sub-minute precision. */
  heartbeat(): Promise<void>;
  /** True once someone cancelled the job: stop early. */
  isCancelled(): Promise<boolean>;
}

export type JobResult = Record<string, unknown> | void | undefined | null;
export type JobHandler<P = unknown> = (payload: P, ctx: JobContext) => Promise<JobResult>;
// Payloads are validated per kind before dispatch, so the map erases their types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JobHandlers = Record<string, JobHandler<any>>;

/** Typed handler entry: `handlers: { ...handle(systemPingJob, async (p) => ({ echo: p.message })) }`. */
export function handle<S extends z.ZodType, K extends string>(
  def: JobDefinition<S, K>,
  fn: JobHandler<z.output<S>>,
): Record<K, JobHandler<z.output<S>>> {
  return { [def.kind]: fn } as Record<K, JobHandler<z.output<S>>>;
}

export interface CreateJobWorkerOptions {
  db: Database;
  redisUrl: string;
  handlers: JobHandlers;
  /** Per-queue concurrency, or one number for every queue. Default 2. */
  concurrency?: number | Partial<Record<JobQueueName, number>>;
  logger: JobLogger;
  /** Reuse an existing connection (not closed by `close()`). */
  connection?: RedisConnection;
}

export interface JobWorker {
  readonly queues: JobQueueName[];
  /** Graceful shutdown: waits for running jobs, then closes Redis. */
  close(): Promise<void>;
}

const ACTIVE = ["queued", "retrying", "running"] as const;

/**
 * Final write of an attempt. Matches the attempt number, so a stale processor (recovery
 * gave up on it and a newer attempt owns the row) cannot overwrite the newer state, and
 * accepts `retrying` too, so a live handler's result survives a recovery that flipped the
 * row under it. A cancelled job is never overwritten. Returns false when nothing matched.
 */
async function finish(
  db: Database,
  id: string,
  attempt: number,
  values: Partial<typeof jobs.$inferInsert>,
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set(values)
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.attempts, attempt),
        inArray(jobs.status, ["running", "retrying"]),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export function createProcessor(db: Database, handlers: JobHandlers, logger: JobLogger) {
  return async function process(bjob: Job<BullJobData>): Promise<JobResult> {
    const id = bjob.id;
    if (!id) throw new UnrecoverableError("BullMQ job without id");
    const bullFinal = bjob.attemptsMade + 1 >= (bjob.opts.attempts ?? 1);

    // Claim the row. 'running' is accepted so a stalled job picked up again can resume.
    const [row] = await db
      .update(jobs)
      .set({
        status: "running",
        attempts: sql`${jobs.attempts} + 1`,
        startedAt: sql`coalesce(${jobs.startedAt}, now())`,
        error: null,
        errorRef: null,
      })
      .where(and(eq(jobs.id, id), inArray(jobs.status, [...ACTIVE])))
      .returning();
    if (!row) {
      logger.warn({ jobId: id, kind: bjob.data.kind }, "job row missing or not active; skipping");
      return { skipped: true };
    }
    // Attempts are counted in Postgres so they survive crash recovery re-adds.
    const attempt = row.attempts;
    const maxAttempts = JOB_MAX_ATTEMPTS;
    const log = { jobId: id, kind: row.kind, attempt };

    let stopBeat: () => void = () => undefined;
    try {
      const def: AnyJobDefinition | undefined = jobDefinitions.get(row.kind);
      const handler = handlers[row.kind];
      if (!def || !handler)
        throw new UnrecoverableError(`No handler registered for job kind "${row.kind}"`);
      const parsed = def.payload.safeParse(row.payload);
      if (!parsed.success) throw new UnrecoverableError(`Invalid payload: ${parsed.error.message}`);

      let lastProgress = row.progress;
      const ctx: JobContext = {
        jobId: id,
        kind: row.kind,
        attempt,
        maxAttempts,
        row,
        db,
        logger,
        async progress(percent) {
          const p = Math.max(0, Math.min(100, Math.round(percent)));
          if (p === lastProgress) return;
          lastProgress = p;
          await db
            .update(jobs)
            .set({ progress: p })
            .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
          await bjob.updateProgress(p).catch(() => undefined);
        },
        async heartbeat() {
          await db
            .update(jobs)
            .set({ updatedAt: new Date() })
            .where(and(eq(jobs.id, id), eq(jobs.status, "running")));
        },
        async isCancelled() {
          const [r] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id));
          return !r || r.status === "cancelled";
        },
      };

      stopBeat = startHeartbeat(
        () => ctx.heartbeat(),
        JOB_HEARTBEAT_MS,
        (err) => logger.warn({ ...log, err: errorMessage(err) }, "job heartbeat failed"),
      );

      logger.info(log, "job started");
      const result = (await handler(parsed.data, ctx)) ?? null;
      const saved = await finish(db, id, attempt, {
        status: "completed",
        progress: 100,
        result,
        error: null,
        errorRef: null,
        endedAt: new Date(),
      });
      if (saved) logger.info(log, "job completed");
      else logger.warn(log, "job is no longer running; result not saved");
      return result;
    } catch (err) {
      const needsAttention = isNeedsAttentionError(err);
      const final =
        needsAttention || isUnrecoverableError(err) || bullFinal || attempt >= maxAttempts;
      const status = !final ? "retrying" : needsAttention ? "needs_attention" : "failed";
      const message = errorMessage(err);
      await finish(db, id, attempt, {
        status,
        error: message,
        errorRef: messageRefOf(err),
        ...(final ? { endedAt: new Date() } : {}),
      }).catch((dbErr) =>
        logger.error({ ...log, err: errorMessage(dbErr) }, "could not persist job failure"),
      );
      logger[final ? "error" : "warn"]({ ...log, status, err: message }, "job failed");
      // Make sure BullMQ does not retry what we already recorded as terminal.
      if (final && !isUnrecoverableError(err)) throw new UnrecoverableError(message);
      throw err;
    } finally {
      stopBeat();
    }
  };
}

/**
 * Consumer side (worker process). One BullMQ Worker per queue that has handlers.
 * Call `close()` on SIGTERM/SIGINT for a graceful shutdown.
 */
export async function createJobWorker(options: CreateJobWorkerOptions): Promise<JobWorker> {
  const { db, handlers, logger } = options;
  const connection =
    options.connection ??
    (await createRedisConnection(options.redisUrl, {
      maxRetriesPerRequest: null,
      connectionName: "forgecy-worker",
    }));

  const byQueue = new Set<JobQueueName>();
  for (const kind of Object.keys(handlers)) {
    const def = jobDefinitions.get(kind);
    if (!def)
      throw new Error(`Handler for unknown job kind "${kind}" (import its defineJob file first)`);
    byQueue.add(def.queue);
  }

  const processor = createProcessor(db, handlers, logger);
  const workers = [...byQueue].map((queue) => {
    const concurrency =
      typeof options.concurrency === "number"
        ? options.concurrency
        : (options.concurrency?.[queue] ?? 2);
    const worker = new Worker<BullJobData>(queue, processor, {
      connection,
      prefix: QUEUE_PREFIX,
      concurrency,
      settings: {
        backoffStrategy: (attemptsMade, type) =>
          type === FORGECY_BACKOFF ? forgecyBackoff(attemptsMade) : 0,
      },
    });
    // Without an error listener a Redis hiccup becomes an unhandled 'error' event.
    worker.on("error", (err) => logger.error({ queue, err: errorMessage(err) }, "worker error"));
    worker.on("stalled", (jobId) => logger.warn({ queue, jobId }, "job stalled; will be retried"));
    return worker;
  });
  logger.info({ queues: [...byQueue] }, "job worker started");

  let closing: Promise<void> | undefined;
  return {
    queues: [...byQueue],
    close() {
      closing ??= (async () => {
        await Promise.all(workers.map((w) => w.close()));
        if (!options.connection) await closeRedisConnection(connection);
        logger.info({}, "job worker stopped");
      })();
      return closing;
    },
  };
}
