import { clients, createDb, eq, jobsLog, memoryItems, type Database } from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptanceRate, agentProposalOutcomes, agentStatistics } from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("agent statistics (integration)", () => {
  let db: Database;
  let clientId: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    const [c] = await db
      .insert(clients)
      .values({ name: "Stats", slug: `stats-${suffix}` })
      .returning({ id: clients.id });
    clientId = c!.id;
  });

  afterAll(async () => {
    await db.delete(jobsLog).where(eq(jobsLog.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });

  it("counts decided proposals, runs per week, failures and cost", async () => {
    const before = await agentProposalOutcomes(db);
    const decided = new Date();
    const old = new Date(Date.now() - 120 * 24 * 3600 * 1000);
    const memory = (status: "approved" | "rejected", at: Date) => ({
      clientId,
      agent: "reviewer" as const,
      category: "fact" as const,
      content: "Something",
      status,
      proposedByAgent: "reviewer" as const,
      decidedAt: at,
    });
    await db
      .insert(memoryItems)
      .values([
        memory("approved", decided),
        memory("approved", decided),
        memory("rejected", decided),
        memory("rejected", old),
      ]);
    const after = await agentProposalOutcomes(db);
    expect(after.reviewer.accepted - before.reviewer.accepted).toBe(2);
    expect(after.reviewer.rejected - before.reviewer.rejected).toBe(1);

    await db.insert(jobsLog).values([
      {
        kind: "slides",
        clientId,
        status: "ok",
        inputSummary: {},
        costMicroUsd: 1500,
        startedAt: decided,
      },
      {
        kind: "slides",
        clientId,
        status: "blocked",
        inputSummary: { blockedReason: "budget_exceeded" },
        startedAt: decided,
      },
    ]);
    const stats = await agentStatistics(db, "copywriter");
    expect(stats.weeks).toHaveLength(12);
    expect(stats.weeks.at(-1)!.runs).toBeGreaterThanOrEqual(2);
    expect(
      stats.failures.find((f) => f.reason === "budget_exceeded")?.count,
    ).toBeGreaterThanOrEqual(1);
    expect(stats.months).toHaveLength(6);
    expect(stats.months.at(-1)!.costMicroUsd).toBeGreaterThanOrEqual(1500);
    expect(stats.slideEdits).not.toBeNull();
    expect((await agentStatistics(db, "reviewer")).slideEdits).toBeNull();
  });

  it("gives a rate only from 10 decided proposals", () => {
    expect(acceptanceRate({ accepted: 5, rejected: 4, stale: 3 })).toBeNull();
    expect(acceptanceRate({ accepted: 6, rejected: 4, stale: 0 })).toBe(0.6);
  });
});
