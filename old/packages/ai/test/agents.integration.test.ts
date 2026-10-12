import type { Actor } from "@forgecy/core";
import {
  agentInstructions,
  agentSettings,
  createDb,
  eq,
  jobsLog,
  users,
  type Database,
} from "@forgecy/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agentRunStats,
  discardAgentInstructionsDraft,
  listAgentRuns,
  loadAgentConfigs,
  publishAgentInstructions,
  saveAgentInstructionsDraft,
  saveAgentRoutes,
  setAgentActive,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;

// The Reviewer has no AI task, so switching it off here never stops other tests' work.
describe.skipIf(!dbUrl)("agent configuration (integration)", () => {
  let db: Database;
  let admin: Actor;
  const member: Actor = {
    type: "user",
    id: "00000000-0000-4000-8000-000000000001",
    isAdmin: false,
    active: true,
    clients: "all",
  };
  const agent: Actor = { type: "agent", role: "reviewer" };
  const suffix = Math.random().toString(36).slice(2, 8);
  let saved: { settings: unknown[]; versions: unknown[] };
  let logId: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    saved = {
      settings: await db.select().from(agentSettings).where(eq(agentSettings.agent, "reviewer")),
      versions: await db
        .select()
        .from(agentInstructions)
        .where(eq(agentInstructions.agent, "reviewer")),
    };
    await db.delete(agentInstructions).where(eq(agentInstructions.agent, "reviewer"));
    await db.delete(agentSettings).where(eq(agentSettings.agent, "reviewer"));
    const [u] = await db
      .insert(users)
      .values({ name: "Admin", email: `agents-${suffix}@example.test`, isAdmin: true })
      .returning({ id: users.id });
    admin = { type: "user", id: u!.id, isAdmin: true, active: true, clients: "all" as const };
  });

  afterAll(async () => {
    await db.delete(agentInstructions).where(eq(agentInstructions.agent, "reviewer"));
    await db.delete(agentSettings).where(eq(agentSettings.agent, "reviewer"));
    if (saved.settings.length)
      await db
        .insert(agentSettings)
        .values(saved.settings as (typeof agentSettings.$inferInsert)[]);
    if (saved.versions.length)
      await db
        .insert(agentInstructions)
        .values(saved.versions as (typeof agentInstructions.$inferInsert)[]);
    if (logId) await db.delete(jobsLog).where(eq(jobsLog.id, logId));
    await db.$client.end();
  });

  it("only an Admin changes an agent; never an agent", async () => {
    await expect(setAgentActive(db, member, "reviewer", true)).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(saveAgentInstructionsDraft(db, agent, "reviewer", "x")).rejects.toMatchObject({
      code: "permission_denied",
    });
  });

  it("switching off needs the key typed", async () => {
    await expect(setAgentActive(db, admin, "reviewer", false, "Reviewer")).rejects.toMatchObject({
      code: "validation",
    });
    await setAgentActive(db, admin, "reviewer", false, "reviewer");
    expect((await loadAgentConfigs(db)).reviewer.active).toBe(false);
    await setAgentActive(db, admin, "reviewer", true);
    expect((await loadAgentConfigs(db)).reviewer.active).toBe(true);
  });

  it("rejects routes for tasks the agent does not run", async () => {
    await expect(
      saveAgentRoutes(db, admin, "reviewer", { slides: { provider: "anthropic" } }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("drafts, publishes and discards instruction versions", async () => {
    const d1 = await saveAgentInstructionsDraft(db, admin, "reviewer", "Be brief.");
    expect(d1).toMatchObject({ version: 1, status: "draft" });
    const again = await saveAgentInstructionsDraft(db, admin, "reviewer", "Be very brief.");
    expect(again.id).toBe(d1.id);
    await expect(publishAgentInstructions(db, admin, "reviewer", "")).rejects.toMatchObject({
      code: "validation",
    });
    const pub = await publishAgentInstructions(db, admin, "reviewer", "First rules");
    expect(pub).toMatchObject({ version: 1, status: "published", text: "Be very brief." });
    await expect(publishAgentInstructions(db, admin, "reviewer", "Again")).rejects.toMatchObject({
      code: "conflict",
    });
    const d2 = await saveAgentInstructionsDraft(db, admin, "reviewer", "Other");
    expect(d2.version).toBe(2);
    await discardAgentInstructionsDraft(db, admin, "reviewer");
    const cfg = (await loadAgentConfigs(db)).reviewer;
    expect(cfg.draft).toBeNull();
    expect(cfg.published?.version).toBe(1);
  });

  it("counts runs by the agent the gateway recorded", async () => {
    const [row] = await db
      .insert(jobsLog)
      .values({
        kind: "test",
        status: "error",
        inputSummary: { agent: { key: "reviewer", instructionsVersion: 1 } },
        costMicroUsd: 5,
      })
      .returning({ id: jobsLog.id });
    logId = row!.id;
    const stats = await agentRunStats(db);
    expect(stats.reviewer.runs).toBeGreaterThanOrEqual(1);
    expect(stats.reviewer.failed).toBeGreaterThanOrEqual(1);
    const runs = await listAgentRuns(db, member, "reviewer");
    expect(runs.find((r) => r.id === logId)).toMatchObject({ instructionsVersion: 1 });
  });
});
