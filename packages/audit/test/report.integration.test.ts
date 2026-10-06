import type { Actor } from "@forgecy/core";
import { auditEvents, audits, clients, createDb, eq, users, type Database } from "@forgecy/db";
import { createQueues, type JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addFinding,
  approveReport,
  checkReportEvidence,
  composeReport,
  confirmCompetitorList,
  convertToClient,
  createProspect,
  recordReportExport,
  requestReportChanges,
  saveReportDraft,
  startAudit,
  submitReport,
  type ReportRow,
} from "../src";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;

describe.skipIf(!dbUrl || !redisUrl)("audit report and conversion (integration)", () => {
  let db: Database;
  let queues: JobQueues;
  let human: Actor;
  const agent: Actor = { type: "agent", role: "strategist" };
  const suffix = Math.random().toString(36).slice(2, 8);
  let clientId: string;
  let auditId: string;
  let report: ReportRow;
  const observationIds: string[] = [];

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    queues = await createQueues(redisUrl!);
    const [u] = await db
      .insert(users)
      .values({ name: "Test", email: `report-${suffix}@example.test`, isAdmin: true })
      .returning({ id: users.id });
    human = { type: "user", id: u!.id, isAdmin: true, active: true };
    const created = await createProspect({ db }, human, {
      name: `Pastry Test ${suffix}`,
      websiteUrl: `pastry-${suffix}.example`,
      objectives: ["more_leads"],
      aiPolicy: "no_ai",
    });
    clientId = created.id;
    ({ auditId } = await startAudit({ db, queues }, human, clientId));
    await confirmCompetitorList({ db, queues }, human, { auditId, skip: true });
    for (const n of [1, 2, 3]) {
      const obs = await addFinding({ db }, human, {
        auditId,
        kind: "observation",
        area: "message",
        channel: "website",
        title: `Observation ${n}`,
        evidence: [{ type: "note", label: `Seen on the home page (${n})` }],
      });
      observationIds.push(obs.id);
      await addFinding({ db }, human, {
        auditId,
        kind: "problem",
        area: "message",
        title: `Problem ${n}`,
        recommendation: `Do thing ${n}`,
        parentIds: [obs.id],
      });
    }
  });

  afterAll(async () => {
    if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
    if (human?.type === "user") {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, human.id));
      await db.delete(users).where(eq(users.id, human.id));
    }
    await queues?.close();
  });

  it("composes one open version at a time, never for an agent", async () => {
    await expect(composeReport({ db, queues }, agent, auditId)).rejects.toMatchObject({
      code: "permission_denied",
    });
    const { reportId, jobId } = await composeReport({ db, queues }, human, auditId);
    expect(jobId).toBeNull(); // no_ai: only people write the texts
    report = (await db.query.auditReports.findFirst({
      where: (r, { eq }) => eq(r.id, reportId),
    }))!;
    expect(report.version).toBe(1);
    expect(report.sections.find((s) => s.key === "overview")?.bullets).toEqual([
      "Problem 1",
      "Problem 2",
      "Problem 3",
    ]);
    await expect(composeReport({ db, queues }, human, auditId)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("blocks review when an included problem loses its evidence", async () => {
    report = await saveReportDraft({ db }, human, {
      id: report.id,
      rev: report.rev,
      excludedFindingIds: [observationIds[0]!],
    });
    const check = await checkReportEvidence(db, report);
    expect(check.ok).toBe(false);
    expect(check.errors[0]).toMatchObject({ title: "Problem 1", section: "problems" });
    await expect(
      submitReport({ db }, human, { id: report.id, rev: report.rev }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      saveReportDraft({ db }, human, {
        id: report.id,
        rev: report.rev - 1,
        excludedFindingIds: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    report = await saveReportDraft({ db }, human, {
      id: report.id,
      rev: report.rev,
      excludedFindingIds: [],
    });
    expect((await checkReportEvidence(db, report)).ok).toBe(true);
  });

  it("marks hand-edited texts as no longer the agent's", async () => {
    const sections = report.sections.map((s) =>
      s.key === "overview" ? { ...s, byAgent: true, intro: "Written by hand" } : s,
    );
    report = await saveReportDraft({ db }, human, { id: report.id, rev: report.rev, sections });
    expect(report.sections.find((s) => s.key === "overview")).toMatchObject({
      intro: "Written by hand",
      byAgent: false,
    });
  });

  it("lets only people approve, with a note when approving their own submission", async () => {
    report = await submitReport({ db }, human, { id: report.id, rev: report.rev });
    expect(report.status).toBe("in_review");
    await expect(
      approveReport({ db }, agent, { id: report.id, rev: report.rev, note: "ok" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      requestReportChanges({ db }, agent, { id: report.id, rev: report.rev, comment: "x" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      approveReport({ db }, human, { id: report.id, rev: report.rev }),
    ).rejects.toMatchObject({ code: "validation" });
    report = await approveReport({ db }, human, {
      id: report.id,
      rev: report.rev,
      note: "Only reviewer at the agency",
    });
    expect(report.status).toBe("approved");
    const audit = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
    expect(audit?.status).toBe("reviewed");
  });

  it("converts the prospect only after the final export", async () => {
    await expect(convertToClient({ db }, human, clientId)).rejects.toMatchObject({
      code: "conflict",
    });
    await recordReportExport(db, human, {
      reportId: report.id,
      variant: "full",
      final: true,
      storageKey: `reports/${suffix}.pdf`,
      fileName: "report.pdf",
      bytes: 1000,
      pages: 8,
    });
    const audit = await db.query.audits.findFirst({ where: eq(audits.id, auditId) });
    expect(audit?.status).toBe("delivered");
    expect(audit?.deliveredAt).toBeInstanceOf(Date);

    await expect(convertToClient({ db }, agent, clientId)).rejects.toMatchObject({
      code: "permission_denied",
    });
    const converted = await convertToClient({ db }, human, clientId);
    expect(converted.id).toBe(clientId);
    const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
    expect(client?.status).toBe("active");
    await expect(convertToClient({ db }, human, clientId)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
