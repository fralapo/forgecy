import { createFakeDb } from "@forgecy/db/testing";
import { describe, expect, it } from "vitest";
import { runAutomationItem } from "../src/handlers";
import { queueNextItem } from "../src/service";

const RUN = "00000000-0000-4000-8000-0000000000a1";
const AUT = "00000000-0000-4000-8000-0000000000a2";
const ITEM = "00000000-0000-4000-8000-0000000000a3";
const CLIENT = "00000000-0000-4000-8000-0000000000a4";
const MINE = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";

describe("queueNextItem", () => {
  it("takes the per-run advisory lock before it reads anything", async () => {
    const fake = createFakeDb({ selects: [[]] }); // run not found: nothing to queue
    const next = await queueNextItem({ db: fake.db, queues: {} as never }, RUN);
    expect(next).toBeNull();
    expect(fake.calls.slice(0, 3)).toEqual(["transaction", "execute", "select"]);
    expect(fake.executed[0]!.sql).toContain("pg_advisory_xact_lock");
    expect(fake.executed[0]!.params).toContain(`automation_run:${RUN}`);
  });

  it("treats a queued item that already has a job as busy, so it never queues a second item", async () => {
    const run = {
      id: RUN,
      automationId: AUT,
      clientId: CLIENT,
      status: "running",
      startedBy: null,
    };
    // The busy probe finds the first item (queued, job attached): nothing else may be queued.
    const fake = createFakeDb({ selects: [[run], [{ status: "active" }], [{ id: ITEM }]] });
    const next = await queueNextItem({ db: fake.db, queues: {} as never }, RUN);
    expect(next).toBeNull();
    expect(fake.calls.filter((c) => c === "select")).toHaveLength(3); // run, automation, busy; no "next" pick
    const busy = fake.wheres[2]!;
    expect(busy).toContain('"automation_run_items"."status" = $');
    expect(busy).toContain('"automation_run_items"."job_id" is not null');
    expect(busy).toContain(" or ");
  });
});

describe("runAutomationItem ownership", () => {
  const item = (over: Record<string, unknown>) => ({
    id: ITEM,
    runId: RUN,
    automationId: AUT,
    status: "queued",
    jobId: null,
    contentId: null,
    input: {},
    ...over,
  });
  const run = { id: RUN, automationId: AUT, clientId: CLIENT, status: "running", startedBy: null };
  const automation = { id: AUT, status: "active" };
  const payload = { runItemId: ITEM };
  const ctx = { jobId: MINE, progress: async () => {} };

  it("claims a queued item with a compare-and-set, and leaves it to the owner when it lost", async () => {
    // The UPDATE matched nothing: another job got there first.
    const fake = createFakeDb({ selects: [[item({})], [run], [automation]], updates: [[]] });
    const out = await runAutomationItem(
      { db: fake.db, queues: {} as never, pipeline: {} as never },
      payload,
      ctx,
    );
    expect(out).toEqual({ status: "duplicate" });
    const where = fake.wheres.find((w) => w.startsWith("update"))!;
    expect(where).toContain('"automation_run_items"."status" = $');
    expect(where).toContain('"automation_run_items"."job_id" is null or');
  });

  it("does not mark a running item INTERRUPTED when another job owns it", async () => {
    const fake = createFakeDb({
      selects: [[item({ status: "running", jobId: OTHER })], [run], [automation]],
    });
    const out = await runAutomationItem(
      { db: fake.db, queues: {} as never, pipeline: {} as never },
      payload,
      ctx,
    );
    expect(out).toEqual({ status: "duplicate" });
    expect(fake.calls).not.toContain("update");
  });
});
