import {
  assertCan,
  AUDIT_LIMITS,
  type comparisonOutcomes,
  confidenceFromEvidence,
  evidenceTypes,
  findingAreas,
  levels,
  USABLE_FINDING_STATUSES,
  type Actor,
  type AuditEvidence,
  type FindingStatus,
} from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";
import {
  and,
  asc,
  auditFindings,
  auditPlans,
  audits,
  eq,
  inArray,
  ne,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { z } from "zod";
import { auditCompareChannelsJob, auditDiagnoseJob, auditPlanJob } from "../jobs";
import {
  assertAiAllowed,
  assertEditable,
  enqueueAuditJob,
  hasActiveJob,
  issueKey,
  loadAudit,
  userIdOf,
  type AuditDeps,
  type Tx,
} from "./common";
import { channelsWithData } from "./queries";

type FindingRow = typeof auditFindings.$inferSelect;

async function loadFinding(db: Database | Tx, id: string): Promise<FindingRow> {
  const [row] = await db.select().from(auditFindings).where(eq(auditFindings.id, id));
  if (!row) throw localizedError("not_found", "audit.errors.itemNotFound");
  return row;
}

async function loadEditable(deps: AuditDeps, id: string) {
  const finding = await loadFinding(deps.db, id);
  const { audit } = await loadAudit(deps.db, finding.auditId);
  assertEditable(audit);
  return { finding, audit };
}

const conflict = () => localizedError("conflict", "audit.errors.itemConflict");

/** Observation changes after a diagnosis show the "Update diagnosis" banner. */
async function touchFindings(tx: Tx, finding: FindingRow) {
  if (finding.kind === "problem") return;
  await tx
    .update(audits)
    .set({ findingsChangedAt: new Date() })
    .where(eq(audits.id, finding.auditId));
  // Problems resting on this observation may no longer hold.
  await tx
    .update(auditFindings)
    .set({ stale: true })
    .where(
      and(
        eq(auditFindings.auditId, finding.auditId),
        eq(auditFindings.kind, "problem"),
        sql`${finding.id} = any(${auditFindings.parentIds})`,
      ),
    );
}

/**
 * Accept or reject an AI finding. Only a person does this: agents can never
 * review, whatever the caller passes (assertCan "review").
 */
export async function reviewFinding(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; decision: "accept" | "reject"; reason?: string; rev: number },
): Promise<FindingRow> {
  const { finding, audit } = await loadEditable(deps, input.id);
  assertCan(actor, "review", audit.clientId);
  if (input.decision === "reject" && finding.kind === "problem" && !input.reason?.trim())
    throw localizedError("validation", "audit.errors.rejectReasonRequired");
  if (input.decision === "accept" && finding.kind === "problem") {
    const count = await usableProblemCount(deps.db, finding.auditId, finding.id);
    if (count >= AUDIT_LIMITS.maxProblems)
      throw localizedError("validation", "audit.errors.problemLimit", {
        max: AUDIT_LIMITS.maxProblems,
      });
  }
  const status: FindingStatus =
    input.decision === "reject" ? "rejected" : finding.editedByHuman ? "edited" : "accepted";
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(auditFindings)
      .set({
        status,
        rejectedReason: input.decision === "reject" ? input.reason?.trim() || null : null,
        updatedBy: userIdOf(actor),
        rev: sql`${auditFindings.rev} + 1`,
      })
      .where(and(eq(auditFindings.id, input.id), eq(auditFindings.rev, input.rev)))
      .returning();
    if (!row) throw conflict();
    await touchFindings(tx, finding);
    await recordAuditEvent(tx, {
      actor,
      action: `audit.finding.${input.decision}`,
      entity: "audit_finding",
      entityId: input.id,
      clientId: audit.clientId,
      meta: { kind: finding.kind, area: finding.area, author: finding.authorAgent ?? "human" },
    });
    return row;
  });
}

/** Undo a decision: back to "To review". */
export async function reopenFinding(deps: AuditDeps, actor: Actor, id: string, rev: number) {
  const { finding, audit } = await loadEditable(deps, id);
  assertCan(actor, "review", audit.clientId);
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(auditFindings)
      .set({ status: "observed", rejectedReason: null, rev: sql`${auditFindings.rev} + 1` })
      .where(and(eq(auditFindings.id, id), eq(auditFindings.rev, rev)))
      .returning({ id: auditFindings.id });
    if (!row) throw conflict();
    await touchFindings(tx, finding);
  });
}

const evidenceSchema = z.object({
  type: z.enum(evidenceTypes),
  sourceId: z.uuid().optional(),
  url: z.string().max(500).optional(),
  quote: z.string().max(300).optional(),
  label: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

export const findingEditSchema = z.object({
  title: z.string().trim().min(1, issueKey("audit.validation.titleRequired")).max(160),
  description: z.string().trim().max(1000).optional(),
  impact: z.string().trim().max(600).optional(),
  recommendation: z.string().trim().max(1000).optional(),
  priority: z.enum(levels).optional(),
});

/** Edit the text or priority: the finding becomes "Edited" and regeneration keeps it. */
export async function editFinding(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; rev: number } & z.input<typeof findingEditSchema>,
): Promise<FindingRow> {
  const { finding, audit } = await loadEditable(deps, input.id);
  assertCan(actor, "edit_draft", audit.clientId);
  const data = findingEditSchema.parse(input);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(auditFindings)
      .set({
        title: data.title,
        description: data.description ?? null,
        impact: data.impact ?? null,
        recommendation: data.recommendation ?? null,
        ...(data.priority ? { priority: data.priority } : {}),
        status: finding.status === "rejected" ? "rejected" : "edited",
        editedByHuman: true,
        updatedBy: userIdOf(actor),
        rev: sql`${auditFindings.rev} + 1`,
      })
      .where(and(eq(auditFindings.id, input.id), eq(auditFindings.rev, input.rev)))
      .returning();
    if (!row) throw conflict();
    await touchFindings(tx, finding);
    await recordAuditEvent(tx, {
      actor,
      action: "audit.finding.edit",
      entity: "audit_finding",
      entityId: input.id,
      clientId: audit.clientId,
    });
    return row;
  });
}

/** Priority is a person's choice; the agent only suggests it. */
export async function setPriority(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; priority: (typeof levels)[number]; rev: number },
) {
  const { audit } = await loadEditable(deps, input.id);
  assertCan(actor, "edit_draft", audit.clientId);
  const [row] = await deps.db
    .update(auditFindings)
    .set({
      priority: input.priority,
      updatedBy: userIdOf(actor),
      rev: sql`${auditFindings.rev} + 1`,
    })
    .where(and(eq(auditFindings.id, input.id), eq(auditFindings.rev, input.rev)))
    .returning();
  if (!row) throw conflict();
  return row;
}

export const newFindingSchema = findingEditSchema.extend({
  auditId: z.uuid(),
  kind: z.enum(["observation", "problem"]),
  area: z.enum(findingAreas),
  channel: z.enum(["website", "instagram", "facebook", "linkedin", "tiktok"]).optional(),
  competitorId: z.uuid().optional(),
  evidence: z.array(evidenceSchema).max(6).default([]),
  parentIds: z.array(z.uuid()).max(8).default([]),
});

/**
 * Add an observation or a problem by hand (also the only way under the no_ai policy).
 * A person wrote it, so it is already accepted. A problem must rest on at least one
 * accepted observation.
 */
export async function addFinding(
  deps: AuditDeps,
  actor: Actor,
  input: z.input<typeof newFindingSchema>,
): Promise<FindingRow> {
  const data = newFindingSchema.parse(input);
  const { audit } = await loadAudit(deps.db, data.auditId);
  assertCan(actor, "edit_draft", audit.clientId);
  assertEditable(audit);
  // A problem rests on its observations: they are its evidence, as in the AI diagnosis.
  let evidence = data.evidence as AuditEvidence[];
  if (data.kind === "problem") {
    if (!data.parentIds.length) throw localizedError("validation", "audit.errors.linkObservation");
    const parents = await deps.db
      .select({ id: auditFindings.id, title: auditFindings.title })
      .from(auditFindings)
      .where(
        and(
          eq(auditFindings.auditId, data.auditId),
          inArray(auditFindings.id, data.parentIds),
          inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
          ne(auditFindings.kind, "problem"),
        ),
      );
    if (parents.length !== data.parentIds.length)
      throw localizedError("validation", "audit.errors.linkAcceptedOnly");
    evidence = [
      ...parents.map((p): AuditEvidence => ({ type: "note", label: p.title.slice(0, 120) })),
      ...evidence,
    ].slice(0, 8);
    if ((await usableProblemCount(deps.db, data.auditId)) >= AUDIT_LIMITS.maxProblems)
      throw localizedError("validation", "audit.errors.problemLimit", {
        max: AUDIT_LIMITS.maxProblems,
      });
  }
  const userId = userIdOf(actor);
  return deps.db.transaction(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${auditFindings.position}), -1) + 1` })
      .from(auditFindings)
      .where(and(eq(auditFindings.auditId, data.auditId), eq(auditFindings.kind, data.kind)));
    const [row] = await tx
      .insert(auditFindings)
      .values({
        auditId: data.auditId,
        kind: data.kind,
        area: data.kind === "problem" ? "cross_channel" : data.area,
        title: data.title,
        description: data.description ?? null,
        impact: data.impact ?? null,
        recommendation: data.recommendation ?? null,
        priority: data.priority ?? "medium",
        confidence: confidenceFromEvidence(evidence.length),
        confidenceReason: evidence.length
          ? `${evidence.length} ${data.kind === "problem" ? "linked items" : "evidence items"} given by a person`
          : "No evidence attached",
        status: "accepted",
        evidence,
        parentIds: data.parentIds,
        channel: data.channel ?? null,
        competitorId: data.competitorId ?? null,
        createdBy: userId,
        updatedBy: userId,
        editedByHuman: true,
        position: Number(next),
      })
      .returning();
    await touchFindings(tx, row!);
    await recordAuditEvent(tx, {
      actor,
      action: "audit.finding.add",
      entity: "audit_finding",
      entityId: row!.id,
      clientId: audit.clientId,
      meta: { kind: data.kind, area: data.area },
    });
    return row!;
  });
}

/** Delete a finding a person wrote. AI findings are rejected instead, so the trace stays. */
export async function deleteFinding(deps: AuditDeps, actor: Actor, id: string) {
  const { finding, audit } = await loadEditable(deps, id);
  assertCan(actor, "edit_draft", audit.clientId);
  if (finding.authorAgent) throw localizedError("validation", "audit.errors.aiNotDeletable");
  await deps.db.transaction(async (tx) => {
    await tx.delete(auditFindings).where(eq(auditFindings.id, id));
    await touchFindings(tx, finding);
    await recordAuditEvent(tx, {
      actor,
      action: "audit.finding.delete",
      entity: "audit_finding",
      entityId: id,
      clientId: audit.clientId,
    });
  });
}

export async function usableProblemCount(db: Database, auditId: string, excludeId?: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        eq(auditFindings.kind, "problem"),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
        excludeId ? ne(auditFindings.id, excludeId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/** Move a problem up or down in the diagnosis order. */
export async function moveProblem(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; direction: "up" | "down" },
) {
  const { finding, audit } = await loadEditable(deps, input.id);
  assertCan(actor, "edit_draft", audit.clientId);
  const list = await deps.db
    .select({ id: auditFindings.id })
    .from(auditFindings)
    .where(and(eq(auditFindings.auditId, finding.auditId), eq(auditFindings.kind, "problem")))
    .orderBy(asc(auditFindings.position), asc(auditFindings.createdAt));
  const ids = list.map((r) => r.id);
  const i = ids.indexOf(input.id);
  const j = input.direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  await deps.db.transaction(async (tx) => {
    for (const [position, id] of ids.entries())
      await tx.update(auditFindings).set({ position }).where(eq(auditFindings.id, id));
  });
}

/** Change the observations a problem rests on (at least one accepted). */
export async function linkObservations(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; observationIds: string[]; rev: number },
) {
  const { finding, audit } = await loadEditable(deps, input.id);
  assertCan(actor, "edit_draft", audit.clientId);
  if (finding.kind !== "problem") throw localizedError("validation", "audit.errors.notAProblem");
  const ids = [...new Set(input.observationIds)];
  if (!ids.length) throw localizedError("validation", "audit.errors.linkObservation");
  const ok = await deps.db
    .select({ id: auditFindings.id })
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, finding.auditId),
        inArray(auditFindings.id, ids),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
        ne(auditFindings.kind, "problem"),
      ),
    );
  if (ok.length !== ids.length) throw localizedError("validation", "audit.errors.linkAcceptedOnly");
  const [row] = await deps.db
    .update(auditFindings)
    .set({
      parentIds: ids,
      stale: false,
      editedByHuman: true,
      status: finding.status === "observed" ? "observed" : "edited",
      updatedBy: userIdOf(actor),
      rev: sql`${auditFindings.rev} + 1`,
    })
    .where(and(eq(auditFindings.id, input.id), eq(auditFindings.rev, input.rev)))
    .returning();
  if (!row) throw conflict();
  return row;
}

/**
 * Change the outcome of a cross-channel row. A note is required when the person
 * disagrees with the agent's proposal, so the report can say why.
 */
export async function setComparisonOutcome(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; outcome: (typeof comparisonOutcomes)[number]; note?: string; rev: number },
) {
  const { finding, audit } = await loadEditable(deps, input.id);
  assertCan(actor, "review", audit.clientId);
  if (finding.kind !== "comparison" || !finding.comparison)
    throw localizedError("validation", "audit.errors.notAComparison");
  const proposed = finding.comparison.proposedOutcome ?? finding.comparison.outcome;
  const note = input.note?.trim();
  if (input.outcome !== proposed && !note)
    throw localizedError("validation", "audit.errors.outcomeNoteRequired");
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(auditFindings)
      .set({
        comparison: {
          ...finding.comparison!,
          proposedOutcome: proposed,
          outcome: input.outcome,
          ...(note ? { outcomeNote: note } : {}),
        },
        status: input.outcome === proposed ? "accepted" : "edited",
        editedByHuman: input.outcome !== proposed || finding.editedByHuman,
        updatedBy: userIdOf(actor),
        rev: sql`${auditFindings.rev} + 1`,
      })
      .where(and(eq(auditFindings.id, input.id), eq(auditFindings.rev, input.rev)))
      .returning();
    if (!row) throw conflict();
    await touchFindings(tx, finding);
    return row;
  });
}

async function assertNotRunning(deps: AuditDeps, auditId: string, kind: string) {
  if (await hasActiveJob(deps.db, auditId, kind))
    throw localizedError("conflict", "audit.errors.stepInProgress");
}

/** Website vs Instagram vs Facebook: needs data on at least two of them. */
export async function requestChannelComparison(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; instruction?: string },
) {
  const { audit, client } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  assertAiAllowed(client);
  await assertNotRunning(deps, audit.id, auditCompareChannelsJob.kind);
  const ready = await channelsWithData(deps.db, audit.id);
  const compared = ready.filter((c) => c === "website" || c === "instagram" || c === "facebook");
  if (compared.length < 2) throw localizedError("validation", "audit.errors.twoChannels");
  return enqueueAuditJob(deps, {
    def: auditCompareChannelsJob,
    payload: {
      auditId: audit.id,
      ...(input.instruction ? { instruction: input.instruction } : {}),
    },
    audit,
    createdBy: userIdOf(actor),
  });
}

/** Strategist diagnosis from the accepted observations ("Generate" / "Update diagnosis"). */
export async function requestDiagnosis(deps: AuditDeps, actor: Actor, auditId: string) {
  const { audit, client } = await loadAudit(deps.db, auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  assertAiAllowed(client);
  await assertNotRunning(deps, audit.id, auditDiagnoseJob.kind);
  const [row] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        ne(auditFindings.kind, "problem"),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
      ),
    );
  if (!row?.n) throw localizedError("validation", "audit.errors.acceptObservation");
  return enqueueAuditJob(deps, {
    def: auditDiagnoseJob,
    payload: { auditId },
    audit,
    createdBy: userIdOf(actor),
  });
}

/** 30-day plan proposal from the accepted problems. */
export async function requestPlan(deps: AuditDeps, actor: Actor, auditId: string) {
  const { audit, client } = await loadAudit(deps.db, auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  assertAiAllowed(client);
  await assertNotRunning(deps, audit.id, auditPlanJob.kind);
  if ((await usableProblemCount(deps.db, auditId)) < 1)
    throw localizedError("validation", "audit.errors.acceptProblem");
  return enqueueAuditJob(deps, {
    def: auditPlanJob,
    payload: { auditId },
    audit,
    createdBy: userIdOf(actor),
  });
}

export async function reviewPlan(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; decision: "accept" | "reject" },
) {
  const { audit } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "review", audit.clientId);
  assertEditable(audit);
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(auditPlans)
      .set({
        status: input.decision === "accept" ? "accepted" : "rejected",
        updatedBy: userIdOf(actor),
      })
      .where(eq(auditPlans.auditId, input.auditId))
      .returning({ id: auditPlans.id });
    if (!row) throw localizedError("not_found", "audit.errors.noPlan");
    await recordAuditEvent(tx, {
      actor,
      action: `audit.plan.${input.decision}`,
      entity: "audit",
      entityId: input.auditId,
      clientId: audit.clientId,
    });
  });
}

export interface ReadinessItem {
  key: "observations" | "competitors" | "problems" | "stale";
  label: string;
  ok: boolean;
  detail?: string;
  /** The number in `detail`, so the interface can word it in the user's language. */
  count?: number;
}

/** What is still missing before the report (Page 11 checklist; the report itself is M3). */
export async function reportReadiness(db: Database, auditId: string): Promise<ReadinessItem[]> {
  const { audit } = await loadAudit(db, auditId);
  const rows = await db
    .select({ kind: auditFindings.kind, status: auditFindings.status, stale: auditFindings.stale })
    .from(auditFindings)
    .where(eq(auditFindings.auditId, auditId));
  const pending = rows.filter((r) => r.status === "observed" && r.kind !== "problem").length;
  const problems = rows.filter(
    (r) => r.kind === "problem" && USABLE_FINDING_STATUSES.includes(r.status),
  );
  const stale = problems.filter((p) => p.stale).length;
  return [
    {
      key: "observations",
      label: "Observations reviewed",
      ok: pending === 0,
      ...(pending ? { detail: `${pending} still to review`, count: pending } : {}),
    },
    {
      key: "competitors",
      label: "Competitor list confirmed",
      ok: Boolean(audit.competitorsConfirmedAt) || audit.competitorsSkipped,
    },
    {
      key: "problems",
      label: `${AUDIT_LIMITS.minProblems} to ${AUDIT_LIMITS.maxProblems} accepted problems`,
      ok:
        problems.length >= AUDIT_LIMITS.minProblems && problems.length <= AUDIT_LIMITS.maxProblems,
      detail: `${problems.length} accepted`,
      count: problems.length,
    },
    {
      key: "stale",
      label: "Diagnosis up to date",
      ok: stale === 0,
      ...(stale ? { detail: `${stale} problems to recheck`, count: stale } : {}),
    },
  ];
}
