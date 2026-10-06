import { Queue } from "bullmq";
import { ForgecyError } from "@forgecy/core";
import { and, eq, inArray, jobs, type Database } from "@forgecy/db";
import type { z } from "zod";
import { defaultJobOptions } from "./backoff";
import { errorMessage } from "./errors";
import {
  getJobDefinition,
  jobDefinitions,
  jobQueues,
  type AnyJobDefinition,
  type JobDefinition,
  type JobQueueName,
} from "./registry";
import { closeRedisConnection, createRedisConnection, type RedisConnection } from "./redis";

export const QUEUE_PREFIX = "forgecy";

/** Data stored in Redis: only the kind. The payload lives in Postgres (jobs.payload). */
export interface BullJobData {
  kind: string;
}

export interface JobQueues {
  get(name: JobQueueName): Queue<BullJobData>;
  close(): Promise<void>;
}

export interface CreateQueuesOptions {
  /** Reuse an existing connection (not closed by `close()`). */
  connection?: RedisConnection;
}

/** Producer side (web app). Queues share one connection that fails fast instead of hanging requests. */
export async function createQueues(
  redisUrl: string,
  options: CreateQueuesOptions = {},
): Promise<JobQueues> {
  const connection =
    options.connection ??
    (await createRedisConnection(redisUrl, {
      maxRetriesPerRequest: 3,
      connectionName: "forgecy-producer",
    }));
  const queues = new Map<JobQueueName, Queue<BullJobData>>();
  for (const name of jobQueues) {
    queues.set(
      name,
      new Queue<BullJobData>(name, { connection, prefix: QUEUE_PREFIX, defaultJobOptions }),
    );
  }
  return {
    get(name) {
      const q = queues.get(name);
      if (!q) throw new Error(`Unknown queue "${name}"`);
      return q;
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      if (!options.connection) await closeRedisConnection(connection);
    },
  };
}

export interface EnqueueInput<S extends z.ZodType = z.ZodType> {
  /** A definition (typed payload) or a registered kind string (payload checked at runtime). */
  kind: JobDefinition<S> | string;
  payload: z.input<S>;
  clientId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  createdBy?: string | null;
  dependsOnJobId?: string | null;
  /** Delay before the first attempt. */
  delayMs?: number;
}

export type JobRow = typeof jobs.$inferSelect;

/**
 * Validate the payload, insert the `jobs` row (status queued) and hand it to BullMQ
 * with jobId = row id. If Redis refuses the job the row is marked failed.
 */
export async function enqueueJob<S extends z.ZodType>(
  db: Database,
  queues: JobQueues,
  input: EnqueueInput<S>,
): Promise<JobRow> {
  const def: AnyJobDefinition =
    typeof input.kind === "string" ? getJobDefinition(input.kind) : input.kind;
  const parsed = def.payload.safeParse(input.payload);
  if (!parsed.success) {
    throw new ForgecyError("validation", `Invalid payload for job ${def.kind}`, {
      issues: parsed.error.issues,
    });
  }
  const [row] = await db
    .insert(jobs)
    .values({
      kind: def.kind,
      status: "queued",
      payload: (parsed.data ?? {}) as Record<string, unknown>,
      clientId: input.clientId ?? null,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      createdBy: input.createdBy ?? null,
      dependsOnJobId: input.dependsOnJobId ?? null,
    })
    .returning();
  if (!row) throw new Error("jobs insert returned no row");
  try {
    await queues.get(def.queue).add(
      def.kind,
      { kind: def.kind },
      {
        jobId: row.id,
        ...(input.delayMs ? { delay: input.delayMs } : {}),
      },
    );
  } catch (err) {
    await db
      .update(jobs)
      .set({
        status: "failed",
        error: `Queue unavailable: ${errorMessage(err)}`,
        endedAt: new Date(),
      })
      .where(eq(jobs.id, row.id));
    throw new ForgecyError("unavailable", "Job queue unavailable", { jobId: row.id });
  }
  return row;
}

/**
 * Cancel a job. Waiting/delayed jobs are removed from Redis; a running handler sees
 * `ctx.isCancelled()` turn true and its final status write is skipped.
 */
export async function cancelJob(db: Database, queues: JobQueues, jobId: string): Promise<boolean> {
  const [row] = await db
    .update(jobs)
    .set({ status: "cancelled", endedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "retrying", "running"])))
    .returning({ kind: jobs.kind });
  if (!row) return false;
  const def = jobDefinitions.get(row.kind);
  if (!def) return true;
  const bull = await queues.get(def.queue).getJob(jobId);
  if (bull) {
    const state = await bull.getState();
    if (state === "waiting" || state === "delayed" || state === "prioritized")
      await bull.remove().catch(() => undefined);
  }
  return true;
}
