import { assertCan, AUDIT_LIMITS, ForgecyError, type Actor } from "@forgecy/core";
import {
  and,
  asc,
  auditCompetitors,
  audits,
  eq,
  inArray,
  ne,
  recordAuditEvent,
  siteScans,
  sql,
} from "@forgecy/db";
import { z } from "zod";
import { auditCrawlJob, auditProposeCompetitorsJob } from "../jobs";
import { domainOf, normalizeSiteUrl } from "../url";
import { createScan } from "./audits";
import {
  assertAiAllowed,
  assertEditable,
  enqueueAuditJob,
  hasActiveJob,
  loadAudit,
  userIdOf,
  type AuditDeps,
} from "./common";

type CompetitorRow = typeof auditCompetitors.$inferSelect;

export const competitorInputSchema = z.object({
  name: z.string().trim().min(1, "Enter the name").max(120),
  websiteUrl: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const url = normalizeSiteUrl(v);
      if (!url) {
        ctx.addIssue({ code: "custom", message: "Invalid website address" });
        return z.NEVER;
      }
      return url;
    }),
  reason: z.string().trim().max(300).optional(),
});

async function loadCompetitor(deps: AuditDeps, id: string) {
  const [row] = await deps.db.select().from(auditCompetitors).where(eq(auditCompetitors.id, id));
  if (!row) throw new ForgecyError("not_found", "Competitor not found");
  const { audit, client } = await loadAudit(deps.db, row.auditId);
  assertEditable(audit);
  return { competitor: row, audit, client };
}

async function activeCount(deps: AuditDeps, auditId: string, excludeId?: string) {
  const [row] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditCompetitors)
    .where(
      and(
        eq(auditCompetitors.auditId, auditId),
        ne(auditCompetitors.status, "removed"),
        excludeId ? ne(auditCompetitors.id, excludeId) : undefined,
      ),
    );
  return row?.n ?? 0;
}

async function assertNotDuplicate(
  deps: AuditDeps,
  auditId: string,
  websiteUrl: string | undefined,
  prospectUrl: string | undefined,
  excludeId?: string,
) {
  const domain = domainOf(websiteUrl);
  if (!domain) return;
  if (domain === domainOf(prospectUrl))
    throw new ForgecyError("validation", "This is the prospect's website, not a competitor's.");
  const others = await deps.db
    .select({ id: auditCompetitors.id, url: auditCompetitors.websiteUrl })
    .from(auditCompetitors)
    .where(and(eq(auditCompetitors.auditId, auditId), ne(auditCompetitors.status, "removed")));
  if (others.some((o) => o.id !== excludeId && domainOf(o.url) === domain))
    throw new ForgecyError("validation", "This competitor is already in the list.");
}

/** A competitor added by a person is already confirmed. */
export async function addCompetitor(
  deps: AuditDeps,
  actor: Actor,
  auditId: string,
  input: z.input<typeof competitorInputSchema>,
): Promise<CompetitorRow> {
  const { audit } = await loadAudit(deps.db, auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  const data = competitorInputSchema.parse(input);
  if ((await activeCount(deps, auditId)) >= AUDIT_LIMITS.maxCompetitors)
    throw new ForgecyError(
      "validation",
      `At most ${AUDIT_LIMITS.maxCompetitors} competitors: remove one first.`,
    );
  await assertNotDuplicate(deps, auditId, data.websiteUrl, audit.inputs.websiteUrl);
  const userId = userIdOf(actor);
  return deps.db.transaction(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${auditCompetitors.position}), -1) + 1` })
      .from(auditCompetitors)
      .where(eq(auditCompetitors.auditId, auditId));
    const [row] = await tx
      .insert(auditCompetitors)
      .values({
        auditId,
        name: data.name,
        websiteUrl: data.websiteUrl ?? null,
        reason: data.reason ?? null,
        confidence: "high",
        status: "confirmed",
        sourceStatus: data.websiteUrl ? "pending" : "unavailable",
        sourceError: data.websiteUrl ? null : "No website given",
        position: Number(next),
        createdBy: userId,
        confirmedBy: userId,
        confirmedAt: new Date(),
      })
      .returning();
    await recordAuditEvent(tx, {
      actor,
      action: "audit.competitor.add",
      entity: "audit_competitor",
      entityId: row!.id,
      clientId: audit.clientId,
    });
    return row!;
  });
}

export async function editCompetitor(
  deps: AuditDeps,
  actor: Actor,
  id: string,
  input: z.input<typeof competitorInputSchema>,
) {
  const { competitor, audit } = await loadCompetitor(deps, id);
  assertCan(actor, "edit_draft", audit.clientId);
  const data = competitorInputSchema.parse(input);
  await assertNotDuplicate(deps, audit.id, data.websiteUrl, audit.inputs.websiteUrl, id);
  const urlChanged = (data.websiteUrl ?? null) !== competitor.websiteUrl;
  const [row] = await deps.db
    .update(auditCompetitors)
    .set({
      name: data.name,
      websiteUrl: data.websiteUrl ?? null,
      reason: data.reason ?? null,
      ...(urlChanged
        ? {
            sourceStatus: data.websiteUrl ? ("pending" as const) : ("unavailable" as const),
            sourceError: data.websiteUrl ? null : "No website given",
          }
        : {}),
    })
    .where(eq(auditCompetitors.id, id))
    .returning();
  return row!;
}

/** Confirm or remove a single proposal (remove needs a reason). */
export async function reviewCompetitor(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; decision: "confirm" | "remove"; reason?: string },
) {
  const { competitor, audit } = await loadCompetitor(deps, input.id);
  assertCan(actor, "review", audit.clientId);
  if (input.decision === "remove" && !input.reason?.trim())
    throw new ForgecyError("validation", "Write why you are removing it.");
  if (
    input.decision === "confirm" &&
    competitor.status === "removed" &&
    (await activeCount(deps, audit.id)) >= AUDIT_LIMITS.maxCompetitors
  )
    throw new ForgecyError("validation", `At most ${AUDIT_LIMITS.maxCompetitors} competitors.`);
  const userId = userIdOf(actor);
  await deps.db.transaction(async (tx) => {
    await tx
      .update(auditCompetitors)
      .set(
        input.decision === "confirm"
          ? {
              status: "confirmed",
              confirmedBy: userId,
              confirmedAt: new Date(),
              removedReason: null,
            }
          : { status: "removed", removedReason: input.reason!.trim() },
      )
      .where(eq(auditCompetitors.id, input.id));
    await recordAuditEvent(tx, {
      actor,
      action: `audit.competitor.${input.decision}`,
      entity: "audit_competitor",
      entityId: input.id,
      clientId: audit.clientId,
      meta: { proposedBy: competitor.proposedByAgent ?? "human" },
    });
  });
}

/**
 * Confirm the list ("Confirm list"): proposals still open become confirmed by
 * this person, then up to 3 pages of each competitor site are read. With `skip`
 * the audit goes on without competitors and the report has no such section.
 */
export async function confirmCompetitorList(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; skip?: boolean },
): Promise<{ scans: number }> {
  const { audit } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "review", audit.clientId);
  assertEditable(audit);
  const userId = userIdOf(actor);
  const now = new Date();
  const nextStatus = (scans: number) =>
    scans > 0
      ? "analyzing"
      : audit.status === "awaiting_competitors" || audit.status === "collecting"
        ? "in_review"
        : audit.status;

  if (input.skip) {
    await deps.db.transaction(async (tx) => {
      await tx
        .update(auditCompetitors)
        .set({ status: "removed", removedReason: "Audit without competitors" })
        .where(
          and(eq(auditCompetitors.auditId, audit.id), eq(auditCompetitors.status, "proposed")),
        );
      await tx
        .update(audits)
        .set({
          competitorsSkipped: true,
          competitorsConfirmedBy: userId,
          competitorsConfirmedAt: now,
          status: nextStatus(0),
        })
        .where(eq(audits.id, audit.id));
      await recordAuditEvent(tx, {
        actor,
        action: "audit.competitors.skip",
        entity: "audit",
        entityId: audit.id,
        clientId: audit.clientId,
      });
    });
    return { scans: 0 };
  }

  const list = await deps.db
    .select()
    .from(auditCompetitors)
    .where(and(eq(auditCompetitors.auditId, audit.id), ne(auditCompetitors.status, "removed")))
    .orderBy(asc(auditCompetitors.position));
  if (!list.length)
    throw new ForgecyError(
      "validation",
      "The list is empty: add a competitor or continue without competitors.",
    );
  const toRead = list.filter((c) => c.websiteUrl && c.sourceStatus === "pending");
  const scanIds = await deps.db.transaction(async (tx) => {
    await tx
      .update(auditCompetitors)
      .set({ status: "confirmed", confirmedBy: userId, confirmedAt: now })
      .where(and(eq(auditCompetitors.auditId, audit.id), eq(auditCompetitors.status, "proposed")));
    const ids: string[] = [];
    for (const c of toRead) {
      ids.push(
        await createScan(deps, tx, {
          auditId: audit.id,
          clientId: audit.clientId,
          rootUrl: c.websiteUrl!,
          competitorId: c.id,
          createdBy: userId,
        }),
      );
    }
    if (toRead.length)
      await tx
        .update(auditCompetitors)
        .set({ sourceStatus: "collecting" })
        .where(
          inArray(
            auditCompetitors.id,
            toRead.map((c) => c.id),
          ),
        );
    await tx
      .update(audits)
      .set({
        competitorsSkipped: false,
        competitorsConfirmedBy: userId,
        competitorsConfirmedAt: now,
        status: nextStatus(ids.length),
      })
      .where(eq(audits.id, audit.id));
    await recordAuditEvent(tx, {
      actor,
      action: "audit.competitors.confirm",
      entity: "audit",
      entityId: audit.id,
      clientId: audit.clientId,
      meta: { competitors: list.length },
    });
    return ids;
  });
  for (const scanId of scanIds) {
    const job = await enqueueAuditJob(deps, {
      def: auditCrawlJob,
      payload: { scanId },
      audit,
      createdBy: userId,
    });
    await deps.db.update(siteScans).set({ jobId: job.id }).where(eq(siteScans.id, scanId));
  }
  return { scans: scanIds.length };
}

/** Change the list after confirming it ("Edit list"). */
export async function reopenCompetitorList(deps: AuditDeps, actor: Actor, auditId: string) {
  const { audit } = await loadAudit(deps.db, auditId);
  assertCan(actor, "review", audit.clientId);
  assertEditable(audit);
  await deps.db
    .update(audits)
    .set({ competitorsConfirmedAt: null, competitorsConfirmedBy: null, competitorsSkipped: false })
    .where(eq(audits.id, auditId));
}

/** Ask the Strategist for (new) proposals, optionally with an instruction. */
export async function requestCompetitorProposal(
  deps: AuditDeps,
  actor: Actor,
  input: { auditId: string; instruction?: string },
) {
  const { audit, client } = await loadAudit(deps.db, input.auditId);
  assertCan(actor, "project.edit", audit.clientId);
  assertEditable(audit);
  assertAiAllowed(client);
  if (await hasActiveJob(deps.db, audit.id, auditProposeCompetitorsJob.kind))
    throw new ForgecyError("conflict", "The proposals are already being prepared.");
  const instruction = input.instruction?.trim().slice(0, 500);
  return enqueueAuditJob(deps, {
    def: auditProposeCompetitorsJob,
    payload: { auditId: audit.id, ...(instruction ? { instruction } : {}) },
    audit,
    createdBy: userIdOf(actor),
  });
}
