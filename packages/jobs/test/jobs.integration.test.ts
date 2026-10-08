import { JOB_MAX_ATTEMPTS } from "@forgecy/core";
import { createDb, eq, inArray, jobs, sql, type Database } from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  LockUnavailableError,
  NeedsAttentionError,
  acquireLock,
  createJobWorker,
  createQueues,
  defineJob,
  enqueueJob,
  handle,
  recoverStaleJobs,
  releaseLock,
  renewLock,
  subscribeJobEvents,
  systemPingJob,
  withLock,
  type JobEvent,
  type JobQueues,
  type JobWorker,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;

const flakyJob = defineJob({
  kind: "test.flaky",
  queue: "default",
  payload: z.object({ failTimes: z.number() }),
});
const attentionJob = defineJob({ kind: "test.attention", queue: "default", payload: z.object({}) });

const silent = { info() {}, warn() {}, error() {}, debug() {} };

async function waitTerminal(db: Database, id: string): Promise<JobEvent[]> {
  const events: JobEvent[] = [];
  for await (const e of subscribeJobEvents(db, id, { intervalMs: 100 })) events.push(e);
  return events;
}

describe.skipIf(!dbUrl || !redisUrl)("jobs (integration)", () => {
  let db: Database;
  let queues: JobQueues;
  let worker: JobWorker;
  const created: string[] = [];
  const seen = new Map<string, number>();

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 4 });
    queues = await createQueues(redisUrl!);
    worker = await createJobWorker({
      db,
      redisUrl: redisUrl!,
      logger: silent,
      concurrency: 4,
      handlers: {
        ...handle(systemPingJob, async (p, ctx) => {
          await ctx.progress(50);
          return { echo: p.message };
        }),
        ...handle(flakyJob, async (p, ctx) => {
          const n = (seen.get(ctx.jobId) ?? 0) + 1;
          seen.set(ctx.jobId, n);
          if (n <= p.failTimes) throw new Error(`boom ${n}`);
          return { attempts: ctx.attempt };
        }),
        ...handle(attentionJob, async () => {
          throw new NeedsAttentionError("Needs a person");
        }),
      },
    });
  });

  afterAll(async () => {
    await worker?.close();
    await queues?.close();
    if (db && created.length) await db.delete(jobs).where(inArray(jobs.id, created));
    await db?.$client.end();
  });

  it("runs system.ping end-to-end", async () => {
    const row = await enqueueJob(db, queues, {
      kind: systemPingJob,
      payload: { message: "hello" },
      entity: "test",
    });
    created.push(row.id);
    expect(row.status).toBe("queued");
    const last = (await waitTerminal(db, row.id)).at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.progress).toBe(100);
    expect(last.result).toEqual({ echo: "hello" });
    const [stored] = await db.select().from(jobs).where(eq(jobs.id, row.id));
    expect(stored?.attempts).toBe(1);
    expect(stored?.startedAt).toBeInstanceOf(Date);
    expect(stored?.endedAt).toBeInstanceOf(Date);
  }, 15_000);

  it("rejects invalid payloads before touching the database", async () => {
    await expect(
      enqueueJob(db, queues, { kind: "system.ping", payload: { nope: 1 } }),
    ).rejects.toMatchObject({
      code: "validation",
    });
  });

  it("retries with backoff and then completes", async () => {
    const row = await enqueueJob(db, queues, { kind: flakyJob, payload: { failTimes: 1 } });
    created.push(row.id);
    const started = Date.now();
    const events = await waitTerminal(db, row.id);
    expect(events.map((e) => e.status)).toContain("retrying");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500); // 5 s backoff
    const last = events.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.attempts).toBe(2);
    expect(last.result).toEqual({ attempts: 2 });
  }, 20_000);

  it("ends in needs_attention without retrying on NeedsAttentionError", async () => {
    const row = await enqueueJob(db, queues, { kind: attentionJob, payload: {} });
    created.push(row.id);
    const last = (await waitTerminal(db, row.id)).at(-1)!;
    expect(last.status).toBe("needs_attention");
    expect(last.attempts).toBe(1);
    expect(last.error).toBe("Needs a person");
  }, 15_000);

  it("recovers stale running jobs", async () => {
    const [a] = await db
      .insert(jobs)
      .values({ kind: "system.ping", status: "running", attempts: 1, payload: { message: "a" } })
      .returning();
    const [b] = await db
      .insert(jobs)
      .values({
        kind: "system.ping",
        status: "running",
        attempts: JOB_MAX_ATTEMPTS,
        payload: { message: "b" },
      })
      .returning();
    created.push(a!.id, b!.id);
    await db.execute(
      sql`update jobs set updated_at = now() - interval '1 hour' where id in (${a!.id}, ${b!.id})`,
    );
    const res = await recoverStaleJobs(db, 10 * 60 * 1000, { queues });
    expect(res.retried).toContain(a!.id);
    expect(res.failed).toContain(b!.id);
    // The retried row was re-added to BullMQ and completes.
    const last = (await waitTerminal(db, a!.id)).at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.attempts).toBe(2);
    const [bRow] = await db.select().from(jobs).where(eq(jobs.id, b!.id));
    expect(bRow?.status).toBe("failed");
  }, 15_000);

  it("re-enqueues a queued row whose BullMQ job never reached Redis", async () => {
    // What a crash between the INSERT and queue.add in enqueueJob leaves behind.
    const [row] = await db
      .insert(jobs)
      .values({ kind: "system.ping", status: "queued", payload: { message: "orphan" } })
      .returning();
    created.push(row!.id);
    await db.execute(
      sql`update jobs set updated_at = now() - interval '10 minutes' where id = ${row!.id}`,
    );
    const res = await recoverStaleJobs(db, 10 * 60 * 1000, { queues });
    expect(res.requeued).toContain(row!.id);
    const last = (await waitTerminal(db, row!.id)).at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.result).toEqual({ echo: "orphan" });
  }, 15_000);

  it("leaves a fresh queued row alone (the enqueue may still be in flight)", async () => {
    const [row] = await db
      .insert(jobs)
      .values({ kind: "system.ping", status: "queued", payload: { message: "fresh" } })
      .returning();
    created.push(row!.id);
    const res = await recoverStaleJobs(db, 10 * 60 * 1000, { queues });
    expect(res.requeued).not.toContain(row!.id);
    await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.id, row!.id));
  });

  describe("content locks", () => {
    // Throwaway table with the same lock columns `contents` will have.
    const table = `forgecy_test_locks_${process.pid}`;
    const id = "00000000-0000-4000-8000-000000000001";
    const j1 = "00000000-0000-4000-8000-0000000000a1";
    const j2 = "00000000-0000-4000-8000-0000000000a2";

    beforeAll(async () => {
      await db.execute(
        sql`create table if not exists ${sql.identifier(table)} (id uuid primary key, locked_by_job_id uuid, lock_expires_at timestamptz)`,
      );
      await db.execute(
        sql`insert into ${sql.identifier(table)} (id) values (${id}) on conflict do nothing`,
      );
    });
    afterAll(async () => {
      await db.execute(sql`drop table if exists ${sql.identifier(table)}`);
    });

    it("acquires, blocks others, renews, releases and expires", async () => {
      expect(await acquireLock(db, { table, id, jobId: j1 })).toBe(true);
      expect(await acquireLock(db, { table, id, jobId: j1 })).toBe(true); // re-entrant for retries
      expect(await acquireLock(db, { table, id, jobId: j2 })).toBe(false);
      expect(await renewLock(db, { table, id, jobId: j2 })).toBe(false);
      expect(await renewLock(db, { table, id, jobId: j1 })).toBe(true);
      expect(await releaseLock(db, { table, id, jobId: j2 })).toBe(false);
      expect(await releaseLock(db, { table, id, jobId: j1 })).toBe(true);
      expect(await acquireLock(db, { table, id, jobId: j2, ttlMs: 1 })).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      expect(await acquireLock(db, { table, id, jobId: j1 })).toBe(true); // expired lock is taken over
      await releaseLock(db, { table, id, jobId: j1 });
    });

    it("withLock releases on error and rejects concurrent holders", async () => {
      await expect(
        withLock(db, { table, id, jobId: j1 }, async () => {
          await expect(
            withLock(db, { table, id, jobId: j2 }, async () => 1),
          ).rejects.toBeInstanceOf(LockUnavailableError);
          throw new Error("handler failed");
        }),
      ).rejects.toThrow("handler failed");
      expect(await acquireLock(db, { table, id, jobId: j2 })).toBe(true);
      await releaseLock(db, { table, id, jobId: j2 });
    });

    it("rejects unsafe table names", async () => {
      await expect(acquireLock(db, { table: "contents; select 1", id, jobId: j1 })).rejects.toThrow(
        /Invalid table/,
      );
    });
  });
});
