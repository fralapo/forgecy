import { PermissionDeniedError } from "@forgecy/core";
import { createDb, inArray, jobsLog, type Database } from "@forgecy/db";
import { createAccessFixture, type AccessFixture } from "@forgecy/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMemory,
  approveMemory,
  getAgentRun,
  getMemory,
  listAgentRuns,
  listMemories,
  memoryCounts,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

/** ADR 0020: a person reaches only the clients assigned to them; Admins reach all. */
describe.skipIf(!dbUrl)("agents: per-client access (integration)", () => {
  let db: Database;
  let f: AccessFixture;
  let memoryOfY: string;
  const runs: string[] = [];

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    f = await createAccessFixture(db);
    memoryOfY = (
      await addMemory(db, f.admin, {
        clientId: f.y.id,
        agent: "copywriter",
        category: "fact",
        content: "Y sells bread",
      })
    ).id;
    const made = await db
      .insert(jobsLog)
      .values(
        [f.x.id, f.y.id, null].map((clientId) => ({
          kind: "test",
          status: "ok" as const,
          clientId,
          inputSummary: { agent: { key: "reviewer" } },
        })),
      )
      .returning({ id: jobsLog.id });
    runs.push(...made.map((r) => r.id));
  });

  afterAll(async () => {
    if (runs.length) await db.delete(jobsLog).where(inArray(jobsLog.id, runs));
    await f?.cleanup();
    await db?.$client.end();
  });

  it("shows only the memories of assigned clients", async () => {
    expect((await listMemories(db, f.member, { status: "all" })).map((m) => m.id)).not.toContain(
      memoryOfY,
    );
    expect(await memoryCounts(db, f.nobody, { clientId: f.y.id })).toEqual({
      candidate: 0,
      approved: 0,
    });
    expect(await getMemory(db, f.member, memoryOfY)).toBeNull();
    expect((await getMemory(db, f.admin, memoryOfY))?.item.id).toBe(memoryOfY);
    await expect(approveMemory(db, f.member, memoryOfY)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      addMemory(db, f.member, {
        clientId: f.y.id,
        agent: "copywriter",
        category: "fact",
        content: "Not mine",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("shows agency runs and runs of assigned clients only", async () => {
    const [onX, onY, agency] = runs as [string, string, string];
    const seen = (await listAgentRuns(db, f.member, "reviewer", 500)).map((r) => r.id);
    expect(seen).toEqual(expect.arrayContaining([onX, agency]));
    expect(seen).not.toContain(onY);
    expect(await getAgentRun(db, f.member, onY)).toBeNull();
    expect(await getAgentRun(db, f.member, agency)).not.toBeNull();
    expect(await getAgentRun(db, f.admin, onY)).not.toBeNull();
  });
});
