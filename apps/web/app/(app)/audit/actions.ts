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
import type {
  AiPolicy,
  ComparisonOutcome,
  Level,
  ReportSectionKey,
  SocialChannel,
} from "@forgecy/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
    return toActionError(err);
  }
}

// ---------------------------------------------------------------- Prospects

export async function createProspectAction(input: ProspectInput) {
  return act((u, d) => createProspect(d, u.actor, input), { queues: false });
}

export async function checkDuplicatesAction(input: {
  name?: string;
  websiteUrl?: string;
  excludeId?: string;
}): Promise<DuplicateMatch[]> {
  await requireUser();
  return findDuplicates(readDeps().db, input, input.excludeId);
}

export async function updateProspectAction(
  clientId: string,
  input: Omit<ProspectInput, "aiPolicy">,
  rev: number,
) {
  return act((u, d) => updateProspect(d, u.actor, clientId, input, rev), { queues: false });
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
    return toActionError(err);
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

export async function deleteReportDraftAction(id: string) {
  return act((u, d) => deleteReportDraft(d, u.actor, id), { queues: false });
}

// ---------------------------------------------------------------- Conversion

export async function convertToClientAction(clientId: string) {
  const res = await act((u, d) => convertToClient(d, u.actor, clientId), { queues: false });
  if (!res.ok) return res;
  revalidatePath("/clienti");
  redirect("/clienti");
}
