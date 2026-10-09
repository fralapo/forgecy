import { createFakeDb } from "@forgecy/db/testing";
import { describe, expect, it, vi } from "vitest";
import { createProcessor } from "../src";

const ID = "00000000-0000-4000-8000-000000000001";
const row = {
  id: ID,
  kind: "system.ping",
  payload: { message: "x" },
  attempts: 2,
  progress: 0,
  status: "running",
};
const bjob = {
  id: ID,
  data: { kind: "system.ping" },
  attemptsMade: 1,
  opts: { attempts: 3 },
  updateProgress: async () => {},
} as never;
const handlers = { "system.ping": async () => ({ ok: true }) };

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("job processor final write", () => {
  it("saves the result only for the attempt that produced it, from running or retrying", async () => {
    const fake = createFakeDb({ updates: [[row], [{ id: ID }]] });
    const out = await createProcessor(fake.db, handlers, logger())(bjob);
    expect(out).toEqual({ ok: true });
    const finishWhere = fake.wheres.filter((w) => w.startsWith("update"))[1]!;
    expect(finishWhere).toContain('"jobs"."attempts" = $');
    expect(finishWhere).toMatch(/"jobs"\."status" in \(\$\d+, \$\d+\)/);
    expect(fake.sets[1]).toMatchObject({ status: "completed", progress: 100 });
  });

  it("warns instead of silently dropping the result when no row matched", async () => {
    const log = logger();
    const fake = createFakeDb({ updates: [[row], []] });
    await createProcessor(fake.db, handlers, log)(bjob);
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("not saved"));
  });
});
