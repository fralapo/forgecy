"use server";

import {
  addCompetitor,
  addFinding,
  addMetric,
  archiveAudit,
  approveReport,
  archiveProspect,
  cancelScan,
  composeReport,
  convertToClient,
  deleteReportDraft,
  confirmCompetitorList,
  createProspect,
  deleteFinding,
  deleteMetric,
  deleteProspect,
  editCompetitor,
  editFinding,
  findDuplicates,
  importTable,
  linkObservations,
  moveProblem,
  previewTable,
  removeSource,
  reopenChannel,
  reopenCompetitorList,
  reopenFinding,
  requestChannelComparison,
  requestCompetitorProposal,
  requestDiagnosis,
  requestPlan,
  requestReportChanges,
  requestReportExport,
  requestReportTexts,
  requestSocialAnalysis,
  rescanSite,
  saveReportDraft,
  submitReport,
  withdrawReport,
  restoreProspect,
  retryScan,
  reviewCompetitor,
  reviewFinding,
  reviewPlan,
  setChannelProfile,
  setChannelUnavailable,
  setComparisonOutcome,
  setPriority,
  setProspectPolicy,
  startAudit,
  updateProspect,
  type DateFormat,
  type DuplicateMatch,
  type ProspectInput,
  type TablePreview,
} from "@forgecy/audit";
import { brandCrawlWebsiteJob, findOrCreateWebsiteSource } from "@forgecy/brand";
import {
  actorWithClient,
  type AiPolicy,
  type ComparisonOutcome,
  type Level,
  type ReportSectionKey,
  type ReportVariant,
  type SocialChannel,
} from "@forgecy/core";
import { and, auditChannelStates, clients, eq, getDb } from "@forgecy/db";
import { enqueueJob } from "@forgecy/jobs";
import { startAuditRead } from "@forgecy/social";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getQueues } from "@/lib/queues";
import { requireUser, type CurrentUser } from "@/lib/session";
import { auditDeps, readDeps, toActionError, type ActionResult } from "./_lib/server";
import type { AuditDeps } from "@forgecy/audit";

async function act<T>(
  fn: (user: CurrentUser, deps: AuditDeps) => Promise<T>,
  options: { queues?: boolean } = {},
): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    const deps = options.queues === false ? readDeps() : await auditDeps();
    const data = await fn(user, deps);
    revalidatePath("/audit", "layout");
    return { ok: true, ...(data === undefined ? {} : { data }) };
  } catch (err) {
    return await toActionError(err);
  }
}

// ---------------------------------------------------------------- Prospects

async function crawlWebsite(
  actor: CurrentUser["actor"],
  userId: string,
  clientId: string,
  websiteUrl: string,
) {
  const db = getDb();
  const source = await findOrCreateWebsiteSource(db, actor, { clientId, websiteUrl });
  await enqueueJob(db, await getQueues(), {
    kind: brandCrawlWebsiteJob,
    payload: { clientId, sourceId: source.id, requestedBy: userId, language: await getLocale() },
    clientId,
    entity: "brand_source",
    entityId: source.id,
    createdBy: userId,
  });
}

export async function createProspectAction(input: ProspectInput) {
  const result = await act((u, d) => createProspect(d, u.actor, input), { queues: false });
  if (result.ok && result.data && input.websiteUrl) {
    const user = await requireUser();
    // The actor was read before the prospect existed; its creator was just given access.
    const actor = actorWithClient(user.actor, result.data.id);
    await crawlWebsite(actor, user.id, result.data.id, input.websiteUrl);
  }
  return result;
}

export async function checkDuplicatesAction(input: {
  name?: string;
  websiteUrl?: string;
  excludeId?: string;
}): Promise<DuplicateMatch[]> {
  const user = await requireUser();
  return findDuplicates(readDeps().db, user.actor, input, input.excludeId);
}

export async function updateProspectAction(
  clientId: string,
  input: Omit<ProspectInput, "aiPolicy">,
  rev: number,
) {
  const before = await readDeps().db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { websiteUrl: true },
  });
  const result = await act((u, d) => updateProspect(d, u.actor, clientId, input, rev), {
    queues: false,
  });
  if (result.ok && input.websiteUrl && input.websiteUrl !== before?.websiteUrl) {
    const user = await requireUser();
    await crawlWebsite(user.actor, user.id, clientId, input.websiteUrl);
  }
  return result;
}

export async function setPolicyAction(clientId: string, policy: AiPolicy) {
  return act((u, d) => setProspectPolicy(d, u.actor, clientId, policy));
}

export async function archiveProspectAction(clientId: string) {
  return act((u, d) => archiveProspect(d, u.actor, clientId), { queues: false });
}

export async function restoreProspectAction(clientId: string) {
  return act((u, d) => restoreProspect(d, u.actor, clientId), { queues: false });
}

export async function deleteProspectAction(clientId: string, confirmName: string) {
  return act((u, d) => deleteProspect(d, u.actor, clientId, confirmName), { queues: false });
}

// ---------------------------------------------------------------- Audit and site

export async function startAuditAction(clientId: string) {
  return act((u, d) => startAudit(d, u.actor, clientId));
}

export async function rescanSiteAction(auditId: string) {
  return act((u, d) => rescanSite(d, u.actor, auditId));
}

export async function retryScanAction(scanId: string) {
  return act((u, d) => retryScan(d, u.actor, scanId));
}

export async function cancelScanAction(scanId: string) {
  return act((u, d) => cancelScan(d, u.actor, scanId));
}

export async function archiveAuditAction(auditId: string) {
  return act((u, d) => archiveAudit(d, u.actor, auditId), { queues: false });
}

// ---------------------------------------------------------------- Findings

export async function reviewFindingAction(input: {
  id: string;
  decision: "accept" | "reject";
  reason?: string;
  rev: number;
}) {
  return act((u, d) => reviewFinding(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function reopenFindingAction(id: string, rev: number) {
  return act((u, d) => reopenFinding(d, u.actor, id, rev), { queues: false });
}

export async function editFindingAction(input: {
  id: string;
  rev: number;
  title: string;
  description?: string;
  impact?: string;
  recommendation?: string;
  priority?: Level;
}) {
  return act((u, d) => editFinding(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function setPriorityAction(input: { id: string; priority: Level; rev: number }) {
  return act((u, d) => setPriority(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function addFindingAction(input: Parameters<typeof addFinding>[2]) {
  return act((u, d) => addFinding(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function deleteFindingAction(id: string) {
  return act((u, d) => deleteFinding(d, u.actor, id), { queues: false });
}

export async function moveProblemAction(id: string, direction: "up" | "down") {
  return act((u, d) => moveProblem(d, u.actor, { id, direction }), { queues: false });
}

export async function linkObservationsAction(input: {
  id: string;
  observationIds: string[];
  rev: number;
}) {
  return act((u, d) => linkObservations(d, u.actor, input).then(() => undefined), {
    queues: false,
  });
}

export async function setComparisonOutcomeAction(input: {
  id: string;
  outcome: ComparisonOutcome;
  note?: string;
  rev: number;
}) {
  return act((u, d) => setComparisonOutcome(d, u.actor, input).then(() => undefined), {
    queues: false,
  });
}

export async function requestComparisonAction(auditId: string, instruction?: string) {
  return act((u, d) =>
    requestChannelComparison(d, u.actor, { auditId, ...(instruction ? { instruction } : {}) }).then(
      (job) => job.id,
    ),
  );
}

export async function requestDiagnosisAction(auditId: string) {
  return act((u, d) => requestDiagnosis(d, u.actor, auditId).then((job) => job.id));
}

export async function requestPlanAction(auditId: string) {
  return act((u, d) => requestPlan(d, u.actor, auditId).then((job) => job.id));
}

export async function reviewPlanAction(auditId: string, decision: "accept" | "reject") {
  return act((u, d) => reviewPlan(d, u.actor, { auditId, decision }), { queues: false });
}

// ---------------------------------------------------------------- Competitors

export async function addCompetitorAction(
  auditId: string,
  input: { name: string; websiteUrl?: string; reason?: string },
) {
  return act((u, d) => addCompetitor(d, u.actor, auditId, input).then(() => undefined), {
    queues: false,
  });
}

export async function editCompetitorAction(
  id: string,
  input: { name: string; websiteUrl?: string; reason?: string },
) {
  return act((u, d) => editCompetitor(d, u.actor, id, input).then(() => undefined), {
    queues: false,
  });
}

export async function reviewCompetitorAction(input: {
  id: string;
  decision: "confirm" | "remove";
  reason?: string;
}) {
  return act((u, d) => reviewCompetitor(d, u.actor, input), { queues: false });
}

export async function confirmCompetitorListAction(auditId: string, skip = false) {
  return act((u, d) => confirmCompetitorList(d, u.actor, { auditId, skip }));
}

export async function reopenCompetitorListAction(auditId: string) {
  return act((u, d) => reopenCompetitorList(d, u.actor, auditId), { queues: false });
}

export async function requestCompetitorProposalAction(auditId: string, instruction?: string) {
  return act((u, d) =>
    requestCompetitorProposal(d, u.actor, {
      auditId,
      ...(instruction ? { instruction } : {}),
    }).then((job) => job.id),
  );
}

// ---------------------------------------------------------------- Social

export async function setChannelProfileAction(
  auditId: string,
  channel: SocialChannel,
  profileUrl?: string,
) {
  return act(
    (u, d) =>
      setChannelProfile(d, u.actor, { auditId, channel, ...(profileUrl ? { profileUrl } : {}) }),
    { queues: false },
  );
}

export async function setChannelUnavailableAction(input: {
  auditId: string;
  channel: SocialChannel;
  mode: "unavailable" | "skipped";
  reason?: string;
}) {
  return act((u, d) => setChannelUnavailable(d, u.actor, input), { queues: false });
}

export async function reopenChannelAction(auditId: string, channel: SocialChannel) {
  return act((u, d) => reopenChannel(d, u.actor, { auditId, channel }), { queues: false });
}

export async function previewTableAction(input: {
  sourceId: string;
  sheet?: string;
  mapping?: Record<string, string>;
  dateFormat?: DateFormat;
}): Promise<ActionResult<TablePreview>> {
  await requireUser();
  try {
    return { ok: true, data: await previewTable(readDeps(), input) };
  } catch (err) {
    return await toActionError(err);
  }
}

export async function importTableAction(input: {
  sourceId: string;
  sheet?: string;
  mapping: Record<string, string>;
  dateFormat: DateFormat;
}) {
  return act((u, d) => importTable(d, u.actor, input), { queues: false });
}

export async function addMetricAction(input: Parameters<typeof addMetric>[2]) {
  return act((u, d) => addMetric(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function deleteMetricAction(id: string) {
  return act((u, d) => deleteMetric(d, u.actor, id), { queues: false });
}

export async function removeSourceAction(id: string) {
  return act((u, d) => removeSource(d, u.actor, id), { queues: false });
}

/** "Read the profile": follows the saved Instagram link once and queues the reading (ADR 0023). */
export async function readProfileAction(auditId: string) {
  return act(async (u, d) => {
    const state = await d.db.query.auditChannelStates.findFirst({
      where: and(
        eq(auditChannelStates.auditId, auditId),
        eq(auditChannelStates.channel, "instagram"),
      ),
    });
    await startAuditRead(d, u.actor, { auditId, profileUrl: state?.profileUrl ?? "" });
  });
}

export async function requestSocialAnalysisAction(auditId: string, channel: SocialChannel) {
  return act((u, d) =>
    requestSocialAnalysis(d, u.actor, { auditId, channel }).then((job) => job.id),
  );
}

// ---------------------------------------------------------------- Report

export async function composeReportAction(auditId: string) {
  return act((u, d) => composeReport(d, u.actor, auditId));
}

export async function requestReportTextsAction(input: {
  reportId: string;
  sections?: ReportSectionKey[];
  email?: boolean;
  instruction?: string;
}) {
  return act((u, d) => requestReportTexts(d, u.actor, input).then((job) => job.id));
}

export async function saveReportDraftAction(input: Parameters<typeof saveReportDraft>[2]) {
  return act((u, d) => saveReportDraft(d, u.actor, input).then((r) => r.rev), {
    queues: false,
  });
}

export async function submitReportAction(input: { id: string; rev: number; note?: string }) {
  return act((u, d) => submitReport(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function withdrawReportAction(id: string, rev: number) {
  return act((u, d) => withdrawReport(d, u.actor, { id, rev }).then(() => undefined), {
    queues: false,
  });
}

export async function approveReportAction(input: { id: string; rev: number; note?: string }) {
  return act((u, d) => approveReport(d, u.actor, input).then(() => undefined), { queues: false });
}

export async function requestReportChangesAction(input: {
  id: string;
  rev: number;
  comment: string;
}) {
  return act((u, d) => requestReportChanges(d, u.actor, input).then(() => undefined), {
    queues: false,
  });
}

export async function requestReportExportAction(input: {
  reportId: string;
  variant: ReportVariant;
  final: boolean;
}) {
  return act((u, d) => requestReportExport(d, u.actor, input).then((job) => job.id));
}

export async function deleteReportDraftAction(id: string) {
  return act((u, d) => deleteReportDraft(d, u.actor, id), { queues: false });
}

// ---------------------------------------------------------------- Conversion

export async function convertToClientAction(clientId: string) {
  const res = await act((u, d) => convertToClient(d, u.actor, clientId), { queues: false });
  if (!res.ok) return res;
  revalidatePath("/clients");
  redirect("/clients");
}
