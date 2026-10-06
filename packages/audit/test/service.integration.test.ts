import type { Actor } from "@forgecy/core";
import { auditEvents, createDb, eq, users, type Database } from "@forgecy/db";
import { createQueues, type JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addFinding,
  createProspect,
  deleteProspect,
  findDuplicates,
  reviewFinding,
  startAudit,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;

describe.skipIf(!dbUrl || !redisUrl)("audit services (integration)", () => {
  let db: Database;
  let queues: JobQueues;
  let human: Actor;
  const agent: Actor = { type: "agent", role: "strategist" };
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Forno Test ${suffix}`;
  let clientId: string;
  let auditId: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    queues = await createQueues(redisUrl!);
    const [u] = await db
      .insert(users)
      .values({ name: "Test", email: `audit-${suffix}@example.test`, isAdmin: true })
      .returning({ id: users.id });
    human = { type: "user", id: u!.id, isAdmin: true, active: true };
  });

  afterAll(async () => {
    if (human?.type === "user") {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, human.id));
      await db.delete(users).where(eq(users.id, human.id));
    }
    await queues?.close();
  });

  it("creates a prospect and finds it as a duplicate", async () => {
    const created = await createProspect({ db }, human, {
      name,
      websiteUrl: `forno-${suffix}.example`,
      objectives: ["more_leads"],
      aiPolicy: "no_ai",
    });
    clientId = created.id;
    expect(created.slug).toBe(`forno-test-${suffix}`);
    const dupes = await findDuplicates(db, {
      name: "Altro",
      websiteUrl: `https://www.forno-${suffix}.example/`,
    });
    expect(dupes.map((d) => d.id)).toContain(clientId);
  });

  it("does not let an agent create prospects", async () => {
    await expect(
      createProspect({ db }, agent, { name: "Da agente", objectives: [] }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("starts one audit at a time", async () => {
    ({ auditId } = await startAudit({ db, queues }, human, clientId));
    await expect(startAudit({ db, queues }, human, clientId)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("lets people write findings and agents only propose", async () => {
    await expect(
      addFinding({ db }, agent, { auditId, kind: "observation", area: "message", title: "x" }),
    ).rejects.toMatchObject({ code: "permission_denied" });

    const obs = await addFinding({ db }, human, {
      auditId,
      kind: "observation",
      area: "message",
      channel: "website",
      title: "La home non dice cosa vendete",
    });
    expect(obs.status).toBe("accepted");
    await expect(
      reviewFinding({ db }, agent, { id: obs.id, decision: "reject", rev: obs.rev }),
    ).rejects.toMatchObject({ code: "permission_denied" });

    await expect(
      addFinding({ db }, human, {
        auditId,
        kind: "problem",
        area: "message",
        title: "Senza prove",
      }),
    ).rejects.toMatchObject({ code: "validation" });

    const problem = await addFinding({ db }, human, {
      auditId,
      kind: "problem",
      area: "message",
      title: "Offerta poco chiara",
      parentIds: [obs.id],
    });
    // Its linked observation is its evidence.
    expect(problem.evidence).toEqual([{ type: "note", label: "La home non dice cosa vendete" }]);
    await expect(
      reviewFinding({ db }, human, { id: problem.id, decision: "reject", rev: problem.rev }),
    ).rejects.toMatchObject({ code: "validation" });
    const rejected = await reviewFinding({ db }, human, {
      id: problem.id,
      decision: "reject",
      reason: "Già coperto",
      rev: problem.rev,
    });
    expect(rejected.status).toBe("rejected");
    await expect(
      reviewFinding({ db }, human, { id: problem.id, decision: "accept", rev: problem.rev }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("deletes a prospect only with its exact name", async () => {
    await expect(deleteProspect({ db }, human, clientId, "forno")).rejects.toMatchObject({
      code: "validation",
    });
    await deleteProspect({ db }, human, clientId, name);
    expect(
      await db.query.clients.findFirst({ where: (c, { eq }) => eq(c.id, clientId) }),
    ).toBeUndefined();
  });
});
