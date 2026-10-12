import { JOB_MAX_ATTEMPTS } from "@forgecy/core";
import { createFakeDb } from "@forgecy/db/testing";
import { describe, expect, it, vi } from "vitest";
import { ensureQueued, recoverStaleJobs, type JobQueues } from "../src";

const ID = "00000000-0000-4000-8000-000000000001";
const ping = (attempts: number) => ({ id: ID, kind: "system.ping", attempts });

/** A queue whose job `ID` is in `state`, or missing when `state` is undefined. */
function fakeQueue(state?: string) {
  const remove = vi.fn(async () => undefined);
  const add = vi.fn(async () => ({}));
  const getJob = vi.fn(async () => (state ? { getState: async () => state, remove } : undefined));
  const queue = { add, getJob };
  const queues = { get: () => queue, close: async () => {} } as unknown as JobQueues;
  return { queue: queue as never, queues, add, remove };
}

describe("ensureQueued", () => {
  it("adds a job that is missing from Redis, with the attempts left", async () => {
    const q = fakeQueue();
    expect(await ensureQueued(q.queue, ping(0), JOB_MAX_ATTEMPTS)).toBe(true);
    expect(q.add).toHaveBeenCalledWith(
      "system.ping",
      { kind: "system.ping" },
      { jobId: ID, attempts: JOB_MAX_ATTEMPTS },
    );
  });

  it("replaces a finished BullMQ job (BullMQ ignores a duplicate jobId)", async () => {
    const q = fakeQueue("failed");
    expect(await ensureQueued(q.queue, ping(2), JOB_MAX_ATTEMPTS)).toBe(true);
    expect(q.remove).toHaveBeenCalledTimes(1);
    expect(q.add).toHaveBeenCalledWith(
      "system.ping",
      { kind: "system.ping" },
      { jobId: ID, attempts: 1 },
    );
  });

  it.each(["waiting", "delayed", "active", "prioritized"])(
    "leaves a %s job alone",
    async (state) => {
      const q = fakeQueue(state);
      expect(await ensureQueued(q.queue, ping(0), JOB_MAX_ATTEMPTS)).toBe(false);
      expect(q.add).not.toHaveBeenCalled();
      expect(q.remove).not.toHaveBeenCalled();
    },
  );
});

describe("recoverStaleJobs", () => {
  it("re-adds a queued row that never reached Redis (crash between INSERT and add)", async () => {
    const q = fakeQueue();
    // 1st select: stale running rows (none); 2nd: orphan candidates.
    const fake = createFakeDb({ selects: [[], [ping(0)]] });
    const res = await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    expect(res).toEqual({ retried: [], failed: [], requeued: [ID] });
    expect(q.add).toHaveBeenCalledTimes(1);
    // Only queued/retrying rows older than the grace period are candidates.
    const where = fake.wheres[1]!;
    expect(where).toMatch(/"jobs"\."status" in \(\$\d+, \$\d+\)/);
    expect(where).toContain('"jobs"."updated_at" < $');
  });

  it("does not report an orphan candidate whose BullMQ job is alive", async () => {
    const q = fakeQueue("waiting");
    const fake = createFakeDb({ selects: [[], [ping(0)]] });
    const res = await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    expect(res.requeued).toEqual([]);
    expect(q.add).not.toHaveBeenCalled();
  });

  it("flips a stale running row to retrying and puts it back in the queue", async () => {
    const q = fakeQueue();
    const fake = createFakeDb({ selects: [[ping(1)], []], updates: [[{ id: ID }]] });
    const res = await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    expect(res.retried).toEqual([ID]);
    expect(q.add).toHaveBeenCalledWith(
      "system.ping",
      { kind: "system.ping" },
      { jobId: ID, attempts: JOB_MAX_ATTEMPTS - 1 },
    );
  });

  it("fails a stale row with no attempts left and does not re-add it", async () => {
    const q = fakeQueue();
    const fake = createFakeDb({
      selects: [[ping(JOB_MAX_ATTEMPTS)], []],
      updates: [[{ id: ID }]],
    });
    const res = await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    expect(res.failed).toEqual([ID]);
    expect(q.add).not.toHaveBeenCalled();
  });

  it("only flips the row it read: the update is a compare-and-set on the attempt number", async () => {
    const q = fakeQueue();
    const fake = createFakeDb({ selects: [[ping(1)], []], updates: [[{ id: ID }]] });
    await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    const where = fake.wheres.find((w) => w.startsWith("update"))!;
    expect(where).toContain('"jobs"."status" = $');
    expect(where).toContain('"jobs"."attempts" = $');
    expect(where).toContain('"jobs"."updated_at" < $');
  });

  it("skips a row that resumed between the select and the update", async () => {
    const q = fakeQueue();
    const fake = createFakeDb({ selects: [[ping(1)], []], updates: [[]] });
    const res = await recoverStaleJobs(fake.db, 600_000, { queues: q.queues });
    expect(res).toEqual({ retried: [], failed: [], requeued: [] });
    expect(q.add).not.toHaveBeenCalled();
  });
});
