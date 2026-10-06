import {
  assertCan,
  COMPACT_REPORT_SECTIONS,
  FIXED_REPORT_SECTIONS,
  reportSectionKeys,
  USABLE_FINDING_STATUSES,
  type Actor,
  type AuditEvidence,
  type ReportSection,
  type ReportSectionKey,
  type ReportStatus,
  type ReportVariant,
} from "@forgecy/core";
import { localizedError } from "@forgecy/i18n";
import {
  and,
  appSettings,
  asc,
  auditChannelStates,
  auditCompetitors,
  auditFindings,
  auditPlans,
  auditReportExports,
  auditReports,
  audits,
  auditSources,
  desc,
  eq,
  inArray,
  ne,
  notify,
  prospectProfiles,
  recordAuditEvent,
  siteScans,
  sql,
  type Database,
} from "@forgecy/db";
import { z } from "zod";
import { auditReportExportJob, auditReportTextsJob } from "../jobs";
import {
  aiAllowed,
  enqueueAuditJob,
  hasActiveJob,
  issueKey,
  loadAudit,
  userIdOf,
  type AuditDeps,
  type Tx,
} from "./common";
import { reportReadiness } from "./findings";
import { fitText, textLength } from "../report/text";
import { channelLabel } from "./prospects";

export type ReportRow = typeof auditReports.$inferSelect;
type FindingRow = typeof auditFindings.$inferSelect;

// Per-language texts of the client deliverable: the `it` entry stays Italian.
const SECTION_TITLES: Record<"it" | "en", Record<ReportSectionKey, string>> = {
  it: {
    cover: "Copertina",
    overview: "Panoramica in 30 secondi",
    problems: "Problemi principali",
    website: "Sito",
    social: "Social",
    competitors: "Competitor",
    cross_channel: "Coerenza tra canali",
    opportunities: "Opportunità",
    next_steps: "Prossimi passi",
    method: "Appendice: metodo e fonti",
  },
  en: {
    cover: "Cover",
    overview: "The 30-second overview",
    problems: "Main problems",
    website: "Website",
    social: "Social media",
    competitors: "Competitors",
    cross_channel: "Cross-channel consistency",
    opportunities: "Opportunities",
    next_steps: "Next steps",
    method: "Appendix: method and sources",
  },
};

/** Limits of the free texts: what an A4 page can hold next to the findings. */
/** Limits of the “Audit report” template pages (section intro, list items). */
export const REPORT_LIMITS = {
  intro: 420,
  nextStepsIntro: 240,
  bullet: 140,
  bullets: 5,
  emailBody: 2000,
} as const;

const SOCIAL = new Set(["instagram", "facebook", "linkedin", "tiktok"]);

/** Which section a finding belongs to; problems and comparisons have their own. */
export function sectionOf(f: Pick<FindingRow, "kind" | "area" | "channel">): ReportSectionKey {
  if (f.kind === "problem") return "problems";
  if (f.kind === "comparison" || f.area === "cross_channel") return "cross_channel";
  if (f.area === "competitors") return "competitors";
  if (f.channel && SOCIAL.has(f.channel)) return "social";
  return "website";
}

function lang(code: string | null | undefined): "it" | "en" {
  return code === "it" ? "it" : "en";
}

// ---------------------------------------------------------------- Data

async function usableFindings(db: Database, auditId: string): Promise<FindingRow[]> {
  return db
    .select()
    .from(auditFindings)
    .where(
      and(
        eq(auditFindings.auditId, auditId),
        inArray(auditFindings.status, [...USABLE_FINDING_STATUSES]),
      ),
    )
    .orderBy(asc(auditFindings.position), asc(auditFindings.createdAt));
}

/** Findings of each section, opportunities included (comparison rows marked as such). */
export function groupFindings(findings: FindingRow[]): Record<ReportSectionKey, FindingRow[]> {
  const out = Object.fromEntries(reportSectionKeys.map((k) => [k, [] as FindingRow[]])) as Record<
    ReportSectionKey,
    FindingRow[]
  >;
  for (const f of findings) {
    out[sectionOf(f)].push(f);
    if (f.kind === "comparison" && f.comparison?.outcome === "opportunity")
      out.opportunities.push(f);
  }
  return out;
}

/** Default sections for a new report: a section without data starts switched off. */
export function defaultSections(
  language: "it" | "en",
  grouped: Record<ReportSectionKey, FindingRow[]>,
): ReportSection[] {
  const withData = (k: ReportSectionKey) =>
    FIXED_REPORT_SECTIONS.includes(k) ||
    k === "overview" ||
    k === "next_steps" ||
    grouped[k].length > 0;
  return reportSectionKeys.map((key) => ({
    key,
    enabled: withData(key),
    title: SECTION_TITLES[language][key],
    intro: "",
    bullets:
      key === "overview"
        ? grouped.problems
            .slice(0, REPORT_LIMITS.bullets)
            .map((p) => fitText(p.title, REPORT_LIMITS.bullet))
        : key === "next_steps"
          ? grouped.problems
              .map((p) => p.recommendation)
              .filter((r): r is string => Boolean(r))
              .map((r) => fitText(r, REPORT_LIMITS.bullet))
              .slice(0, REPORT_LIMITS.bullets)
          : [],
  }));
}

// ---------------------------------------------------------------- Evidence check

export type EvidenceIssueCode =
  "no_linked_observation" | "no_evidence" | "screenshot_removed" | "source_removed";

export interface EvidenceIssue {
  findingId: string;
  title: string;
  section: ReportSectionKey;
  /** Stable id of the reason; the interface translates it. */
  code: EvidenceIssueCode;
  reason: string;
}

export interface EvidenceCheck {
  ok: boolean;
  included: number;
  errors: EvidenceIssue[];
  warnings: Array<{ section: ReportSectionKey; code: "empty" | "over_limit"; message: string }>;
}

function evidenceOf(f: FindingRow): AuditEvidence[] {
  if (f.kind !== "comparison" || !f.comparison) return f.evidence;
  return [...f.evidence, ...Object.values(f.comparison.cells).flatMap((c) => c?.evidence ?? [])];
}

/**
 * Every included observation and problem must rest on evidence that still exists:
 * a source row with its file or URL, or (for problems) an included observation.
 * Errors block review, approval and the final PDF (REPORT-EVIDENCE-MISSING).
 */
export async function checkReportEvidence(
  db: Database,
  report: Pick<ReportRow, "auditId" | "sections" | "excludedFindingIds">,
): Promise<EvidenceCheck> {
  const findings = await usableFindings(db, report.auditId);
  const grouped = groupFindings(findings);
  const enabled = new Set(report.sections.filter((s) => s.enabled).map((s) => s.key));
  const excluded = new Set(report.excludedFindingIds);
  const included = findings.filter((f) => !excluded.has(f.id) && enabled.has(sectionOf(f)));
  const includedIds = new Set(included.map((f) => f.id));
  const sourceIds = [
    ...new Set(included.flatMap((f) => evidenceOf(f).map((e) => e.sourceId)).filter(Boolean)),
  ] as string[];
  const sources = sourceIds.length
    ? await db
        .select({
          id: auditSources.id,
          kind: auditSources.kind,
          url: auditSources.url,
          storageKey: auditSources.storageKey,
        })
        .from(auditSources)
        .where(inArray(auditSources.id, sourceIds))
    : [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const alive = (e: AuditEvidence) => {
    if (!e.sourceId) return e.type !== "screenshot";
    const s = byId.get(e.sourceId);
    if (!s) return false;
    if (s.kind === "page") return Boolean(s.url);
    return Boolean(s.storageKey);
  };

  const errors: EvidenceIssue[] = [];
  for (const f of included) {
    const section = sectionOf(f);
    if (f.kind === "problem") {
      if (!f.parentIds.some((id) => includedIds.has(id)))
        errors.push({
          findingId: f.id,
          title: f.title,
          section,
          code: "no_linked_observation",
          reason: "No linked observation is included in the report",
        });
      continue;
    }
    const ev = evidenceOf(f);
    if (!ev.length) {
      errors.push({
        findingId: f.id,
        title: f.title,
        section,
        code: "no_evidence",
        reason: "No evidence",
      });
      continue;
    }
    if (!ev.some(alive))
      errors.push({
        findingId: f.id,
        title: f.title,
        section,
        ...(ev[0]?.type === "screenshot"
          ? { code: "screenshot_removed", reason: "Screenshot removed from the Social Audit" }
          : { code: "source_removed", reason: "The cited source no longer exists" }),
      });
  }

  const warnings: EvidenceCheck["warnings"] = [];
  for (const s of report.sections) {
    if (!s.enabled || s.key === "cover" || s.key === "method") continue;
    const hasItems = (grouped[s.key] ?? []).some((f) => includedIds.has(f.id));
    if (!s.intro.trim() && !s.bullets.length && !hasItems)
      warnings.push({ section: s.key, code: "empty", message: "Section with no text or items" });
    const introMax = s.key === "next_steps" ? REPORT_LIMITS.nextStepsIntro : REPORT_LIMITS.intro;
    if (textLength(s.intro) > introMax)
      warnings.push({ section: s.key, code: "over_limit", message: "Text over the page limit" });
  }
  return { ok: errors.length === 0, included: included.length, errors, warnings };
}

// ---------------------------------------------------------------- Lifecycle

async function loadReport(db: Database, id: string) {
  const report = await db.query.auditReports.findFirst({ where: eq(auditReports.id, id) });
  if (!report) throw localizedError("not_found", "audit.errors.reportNotFound");
  const { audit, client } = await loadAudit(db, report.auditId);
  return { report, audit, client };
}

function assertStatus(report: ReportRow, ...allowed: ReportStatus[]) {
  if (!allowed.includes(report.status))
    throw localizedError(
      "conflict",
      report.status === "in_review" ? "audit.errors.reportInReview" : "audit.errors.reportLocked",
    );
}

function conflict() {
  return localizedError("conflict", "audit.errors.reportConflict");
}

async function updateReport(
  tx: Database | Tx,
  report: Pick<ReportRow, "id" | "rev">,
  values: Partial<typeof auditReports.$inferInsert>,
  actor: Actor,
): Promise<ReportRow> {
  const [row] = await tx
    .update(auditReports)
    .set({ ...values, updatedBy: userIdOf(actor), rev: sql`${auditReports.rev} + 1` })
    .where(and(eq(auditReports.id, report.id), eq(auditReports.rev, report.rev)))
    .returning();
  if (!row) throw conflict();
  return row;
}

async function event(
  tx: Database | Tx,
  actor: Actor,
  action: string,
  report: Pick<ReportRow, "id" | "version">,
  clientId: string,
  meta: Record<string, unknown> = {},
) {
  await recordAuditEvent(tx, {
    actor,
    action,
    entity: "audit_report",
    entityId: report.id,
    clientId,
    meta: { version: report.version, ...meta },
  });
}

/**
 * “Compose report”: the first draft, or the next version copied from the latest
 * one. The audit must be reviewed (UX: the report comes after the diagnosis).
 * With AI allowed the Strategist and the Copywriter then propose the texts.
 */
export async function composeReport(
  deps: AuditDeps,
  actor: Actor,
  auditId: string,
): Promise<{ reportId: string; jobId: string | null }> {
  const { audit, client } = await loadAudit(deps.db, auditId);
  assertCan(actor, "edit_draft", audit.clientId);
  if (audit.status === "archived")
    throw localizedError("conflict", "audit.errors.auditArchivedReport");
  const readiness = await reportReadiness(deps.db, auditId);
  const missing = readiness.filter((r) => !r.ok);
  if (missing.length)
    throw localizedError("validation", "audit.errors.reportNotReady", { count: missing.length });
  const latest = await deps.db.query.auditReports.findFirst({
    where: eq(auditReports.auditId, auditId),
    orderBy: desc(auditReports.version),
  });
  if (latest && (latest.status === "draft" || latest.status === "in_review"))
    throw localizedError("conflict", "audit.errors.versionOpen", { version: latest.version });
  const profile = await deps.db.query.prospectProfiles.findFirst({
    where: eq(prospectProfiles.clientId, client.id),
  });
  const grouped = groupFindings(await usableFindings(deps.db, auditId));
  const sections = latest?.sections.length
    ? latest.sections
    : defaultSections(lang(profile?.reportLanguage), grouped);
  const userId = userIdOf(actor);

  const report = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(auditReports)
      .values({
        auditId,
        version: (latest?.version ?? 0) + 1,
        sections,
        excludedFindingIds: latest?.excludedFindingIds ?? [],
        emailSubject: latest?.emailSubject ?? null,
        emailBody: latest?.emailBody ?? null,
        emailByAgent: latest?.emailByAgent ?? false,
        findingsAt: audit.findingsChangedAt ?? new Date(),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    await event(tx, actor, "audit.report.compose", row!, audit.clientId, {
      from: latest?.version ?? null,
    });
    return row!;
  });

  let jobId: string | null = null;
  if (!latest && aiAllowed(client.aiPolicy)) {
    const job = await enqueueAuditJob(deps, {
      def: auditReportTextsJob,
      payload: { reportId: report.id, email: true },
      audit,
      createdBy: userId,
    });
    jobId = job.id;
  }
  return { reportId: report.id, jobId };
}

/** “Recompose section” / “Regenerate text”: hand-edited texts are kept. */
export async function requestReportTexts(
  deps: AuditDeps,
  actor: Actor,
  input: { reportId: string; sections?: ReportSectionKey[]; email?: boolean; instruction?: string },
) {
  const { report, audit, client } = await loadReport(deps.db, input.reportId);
  assertCan(actor, "edit_draft", audit.clientId);
  assertStatus(report, "draft");
  if (!aiAllowed(client.aiPolicy))
    throw localizedError("policy_blocked", "audit.errors.policyNoAiTexts");
  if (await hasActiveJob(deps.db, audit.id, auditReportTextsJob.kind))
    throw localizedError("conflict", "audit.errors.textsInProgress");
  return enqueueAuditJob(deps, {
    def: auditReportTextsJob,
    payload: {
      reportId: report.id,
      ...(input.sections ? { sections: input.sections } : {}),
      email: input.email ?? false,
      ...(input.instruction ? { instruction: input.instruction } : {}),
    },
    audit,
    createdBy: userIdOf(actor),
  });
}

export const reportSectionsSchema = z
  .array(
    z.object({
      key: z.enum(reportSectionKeys),
      enabled: z.boolean(),
      title: z.string().trim().min(1, issueKey("audit.validation.sectionTitleRequired")).max(120),
      intro: z.string().max(REPORT_LIMITS.intro, issueKey("audit.validation.introTooLong")),
      bullets: z
        .array(z.string().trim().min(1).max(REPORT_LIMITS.bullet))
        .max(REPORT_LIMITS.bullets),
      byAgent: z.boolean().optional(),
    }),
  )
  .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Repeated section")
  .refine(
    (s) => FIXED_REPORT_SECTIONS.every((k) => s.find((x) => x.key === k)?.enabled),
    "Cover and method always stay in the report",
  );

/** Save the structure and texts of a draft (order, on/off, titles, intros, exclusions). */
export async function saveReportDraft(
  deps: AuditDeps,
  actor: Actor,
  input: {
    id: string;
    rev: number;
    sections?: z.input<typeof reportSectionsSchema>;
    excludedFindingIds?: string[];
    emailSubject?: string;
    emailBody?: string;
  },
): Promise<ReportRow> {
  const { report, audit } = await loadReport(deps.db, input.id);
  if (report.rev !== input.rev) throw conflict();
  assertCan(actor, "edit_draft", audit.clientId);
  assertStatus(report, "draft");
  const values: Partial<typeof auditReports.$inferInsert> = {};
  if (input.sections) {
    const next = reportSectionsSchema.parse(input.sections);
    const before = new Map(report.sections.map((s) => [s.key, s]));
    // A text changed by hand is no longer the agent's.
    values.sections = next.map((s) => {
      const prev = before.get(s.key);
      const same =
        prev &&
        prev.intro === s.intro &&
        JSON.stringify(prev.bullets) === JSON.stringify(s.bullets);
      return { ...s, byAgent: same ? Boolean(prev?.byAgent) : false };
    });
  }
  if (input.excludedFindingIds)
    values.excludedFindingIds = z.array(z.uuid()).max(500).parse(input.excludedFindingIds);
  if (input.emailSubject !== undefined || input.emailBody !== undefined) {
    values.emailSubject =
      z
        .string()
        .trim()
        .max(160)
        .parse(input.emailSubject ?? "") || null;
    values.emailBody =
      z
        .string()
        .trim()
        .max(REPORT_LIMITS.emailBody)
        .parse(input.emailBody ?? "") || null;
    values.emailByAgent = false;
  }
  return updateReport(deps.db, report, values, actor);
}

/** “Submit for review”: the draft becomes read-only. Blocked by missing evidence. */
export async function submitReport(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; rev: number; note?: string; reviewerId?: string | null },
) {
  const { report, audit } = await loadReport(deps.db, input.id);
  if (report.rev !== input.rev) throw conflict();
  assertCan(actor, "edit_draft", audit.clientId);
  assertStatus(report, "draft");
  const check = await checkReportEvidence(deps.db, report);
  if (!check.ok)
    throw localizedError("validation", "audit.errors.evidenceMissingFix", {
      count: check.errors.length,
    });
  return deps.db.transaction(async (tx) => {
    const row = await updateReport(
      tx,
      report,
      {
        status: "in_review",
        submittedBy: userIdOf(actor),
        submittedAt: new Date(),
        submitNote: input.note?.trim() || null,
        reviewerId: input.reviewerId ?? null,
        changesRequested: null,
      },
      actor,
    );
    await event(tx, actor, "audit.report.submit", row, audit.clientId);
    await notify(tx, {
      kind: "report_review_requested",
      to: input.reviewerId ? [input.reviewerId] : "everyone",
      except: userIdOf(actor),
      clientId: audit.clientId,
      params: { version: report.version },
      href: (slug) => `/audit/${slug}/report`,
    });
    return row;
  });
}

/** “Withdraw from review”. */
export async function withdrawReport(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; rev: number },
) {
  const { report, audit } = await loadReport(deps.db, input.id);
  if (report.rev !== input.rev) throw conflict();
  assertCan(actor, "edit_draft", audit.clientId);
  assertStatus(report, "in_review");
  return deps.db.transaction(async (tx) => {
    const row = await updateReport(tx, report, { status: "draft" }, actor);
    await event(tx, actor, "audit.report.withdraw", row, audit.clientId);
    return row;
  });
}

/**
 * “Mark review complete”. Only people approve (agents get permission_denied).
 * Approving one's own submission needs a note for the record. The audit becomes
 * reviewed and older approved or exported versions are superseded.
 */
export async function approveReport(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; rev: number; note?: string },
) {
  const { report, audit } = await loadReport(deps.db, input.id);
  if (report.rev !== input.rev) throw conflict();
  assertCan(actor, "approve", audit.clientId);
  assertStatus(report, "in_review");
  const note = input.note?.trim() ?? "";
  if (report.submittedBy && report.submittedBy === userIdOf(actor) && !note)
    throw localizedError("validation", "audit.errors.ownApprovalNote");
  const check = await checkReportEvidence(deps.db, report);
  if (!check.ok)
    throw localizedError("validation", "audit.errors.evidenceMissing", {
      count: check.errors.length,
    });
  return deps.db.transaction(async (tx) => {
    const row = await updateReport(
      tx,
      report,
      {
        status: "approved",
        approvedBy: userIdOf(actor),
        approvedAt: new Date(),
        approvalNote: note || null,
      },
      actor,
    );
    await tx
      .update(auditReports)
      .set({ status: "superseded" })
      .where(
        and(
          eq(auditReports.auditId, report.auditId),
          ne(auditReports.id, report.id),
          inArray(auditReports.status, ["approved", "exported"]),
        ),
      );
    if (audit.status !== "delivered")
      await tx.update(audits).set({ status: "reviewed" }).where(eq(audits.id, audit.id));
    await event(tx, actor, "audit.report.approve", row, audit.clientId, {
      selfApproved: report.submittedBy === userIdOf(actor),
    });
    await notify(tx, {
      kind: "report_approved",
      to: [report.submittedBy],
      except: userIdOf(actor),
      clientId: audit.clientId,
      params: { version: report.version },
      href: (slug) => `/audit/${slug}/report`,
    });
    return row;
  });
}

/** “Request changes”: back to draft with the comment on top of the editor. */
export async function requestReportChanges(
  deps: AuditDeps,
  actor: Actor,
  input: { id: string; rev: number; comment: string },
) {
  const { report, audit } = await loadReport(deps.db, input.id);
  if (report.rev !== input.rev) throw conflict();
  assertCan(actor, "review", audit.clientId);
  assertStatus(report, "in_review");
  const comment = input.comment.trim();
  if (!comment) throw localizedError("validation", "audit.errors.changesRequired");
  return deps.db.transaction(async (tx) => {
    const row = await updateReport(
      tx,
      report,
      { status: "draft", changesRequested: comment.slice(0, 1000) },
      actor,
    );
    await event(tx, actor, "audit.report.request_changes", row, audit.clientId);
    await notify(tx, {
      kind: "report_changes_requested",
      to: [report.submittedBy],
      except: userIdOf(actor),
      clientId: audit.clientId,
      params: { version: report.version },
      href: (slug) => `/audit/${slug}/report`,
    });
    return row;
  });
}

/** “Delete draft”: only drafts never sent to review. */
export async function deleteReportDraft(deps: AuditDeps, actor: Actor, id: string) {
  const { report, audit } = await loadReport(deps.db, id);
  assertCan(actor, "edit_draft", audit.clientId);
  if (report.status !== "draft" || report.submittedAt)
    throw localizedError("conflict", "audit.errors.draftOnlyDelete");
  await deps.db.transaction(async (tx) => {
    await tx.delete(auditReports).where(eq(auditReports.id, id));
    await event(tx, actor, "audit.report.delete_draft", report, audit.clientId);
  });
}

/**
 * “Export PDF”: a draft PDF (“Draft” watermark) at any time before delivery, the
 * final one only for an approved version with every included item backed by evidence.
 */
export async function requestReportExport(
  deps: AuditDeps,
  actor: Actor,
  input: { reportId: string; variant: ReportVariant; final: boolean },
) {
  const { report, audit } = await loadReport(deps.db, input.reportId);
  assertCan(actor, "reports.export", audit.clientId);
  if (report.status === "superseded") throw localizedError("conflict", "audit.errors.superseded");
  if (input.final) {
    assertCan(actor, "publish", audit.clientId);
    if (report.status !== "approved" && report.status !== "exported")
      throw localizedError("conflict", "audit.errors.finalNeedsApproval");
    const check = await checkReportEvidence(deps.db, report);
    if (!check.ok)
      throw localizedError("validation", "audit.errors.evidenceMissing", {
        count: check.errors.length,
      });
  }
  if (await hasActiveJob(deps.db, audit.id, auditReportExportJob.kind))
    throw localizedError("conflict", "audit.errors.pdfInProgress");
  return enqueueAuditJob(deps, {
    def: auditReportExportJob,
    payload: { reportId: report.id, variant: input.variant, final: input.final },
    audit,
    createdBy: userIdOf(actor),
  });
}

/**
 * Record a PDF produced by the export worker. The first final export moves the
 * version to exported and the audit to delivered.
 */
export async function recordReportExport(
  db: Database,
  actor: Actor,
  input: {
    reportId: string;
    variant: ReportVariant;
    final: boolean;
    storageKey: string;
    fileName: string;
    bytes: number;
    pages: number;
    jobId?: string | null;
  },
) {
  const { report, audit } = await loadReport(db, input.reportId);
  assertCan(actor, "reports.export", audit.clientId);
  if (input.final) {
    assertCan(actor, "publish", audit.clientId);
    assertStatus(report, "approved", "exported");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(auditReportExports)
      .values({
        reportId: report.id,
        variant: input.variant,
        final: input.final,
        storageKey: input.storageKey,
        fileName: input.fileName,
        bytes: input.bytes,
        pages: input.pages,
        jobId: input.jobId ?? null,
        createdBy: userIdOf(actor),
      })
      .returning();
    if (input.final && report.status === "approved") {
      await tx
        .update(auditReports)
        .set({ status: "exported", exportedAt: new Date() })
        .where(eq(auditReports.id, report.id));
      await tx
        .update(audits)
        .set({ status: "delivered", deliveredAt: new Date() })
        .where(eq(audits.id, audit.id));
    }
    await event(tx, actor, "audit.report.export", report, audit.clientId, {
      variant: input.variant,
      final: input.final,
    });
    return row!;
  });
}

// ---------------------------------------------------------------- Document

export interface ReportDocItem {
  id: string;
  kind: FindingRow["kind"];
  title: string;
  description: string | null;
  impact: string | null;
  recommendation: string | null;
  priority: FindingRow["priority"];
  evidence: string[];
  /** Problems: titles of the included observations they rest on. */
  causes: string[];
}

export interface ReportDocSection {
  key: ReportSectionKey;
  title: string;
  intro: string;
  bullets: string[];
  /** Short closing line (method: limits of the data). */
  note: string;
  items: ReportDocItem[];
}

export interface ReportDocument {
  language: "it" | "en";
  agency: { name: string | null };
  prospect: { name: string; websiteUrl: string | null };
  version: number;
  status: ReportStatus;
  variant: ReportVariant;
  date: string;
  sections: ReportDocSection[];
}

// Per-language texts of the client deliverable: the `it` entry stays Italian.
const METHOD_TEXT = {
  it: {
    intro:
      "L'audit usa solo dati pubblici e materiali forniti. Ogni evidenza riporta la sua fonte; le proposte dell'AI sono state verificate da una persona dell'agenzia.",
    note: "I dati social vengono da screenshot e file forniti, non sono raccolti in automatico. Un valore mancante è indicato come non disponibile, mai stimato.",
    site: (date: string, pages: number) =>
      `Sito: letto il ${date}, fino a ${pages} pagine pubbliche`,
    channel: (label: string) => `${label}: screenshot, export o valori forniti`,
    unavailable: (label: string) => `${label}: non disponibile`,
    competitors: (n: number) => `Competitor: ${n} confermati, fino a 3 pagine ciascuno`,
    noCompetitors: "Competitor: sezione esclusa su scelta dell'agenzia",
    plan: "Piano di 30 giorni: proposto dallo Strategist, accettato dall'agenzia",
  },
  en: {
    intro:
      "The audit uses only public data and material provided to us. Every finding cites its source; AI proposals were checked by a person at the agency.",
    note: "Social data comes from screenshots and files provided, never collected automatically. A missing value is marked as not available, never estimated.",
    site: (date: string, pages: number) => `Website: read on ${date}, up to ${pages} public pages`,
    channel: (label: string) => `${label}: screenshots, exports or values provided`,
    unavailable: (label: string) => `${label}: not available`,
    competitors: (n: number) => `Competitors: ${n} confirmed, up to 3 pages each`,
    noCompetitors: "Competitors: left out by the agency",
    plan: "30-day plan: proposed by the Strategist, accepted by the agency",
  },
} as const;

/** The method page: what was read, from where, and the limits of the data. */
function methodText(
  language: "it" | "en",
  input: {
    channels: Array<typeof auditChannelStates.$inferSelect>;
    scans: Array<typeof siteScans.$inferSelect>;
    competitors: number;
    skipped: boolean;
    plan: boolean;
  },
): { intro: string; lines: string[]; note: string } {
  const t = METHOD_TEXT[language];
  const lines: string[] = [];
  const site = input.scans.find((s) => !s.competitorId);
  if (site)
    lines.push(
      t.site((site.finishedAt ?? site.createdAt).toISOString().slice(0, 10), site.maxPages),
    );
  for (const c of input.channels.filter((x) => x.channel !== "website")) {
    const label = channelLabel[c.channel];
    if (c.status === "unavailable" || c.status === "skipped") lines.push(t.unavailable(label));
    else if (c.status === "collected" || c.status === "partial") lines.push(t.channel(label));
  }
  lines.push(input.skipped ? t.noCompetitors : t.competitors(input.competitors));
  if (input.plan) lines.push(t.plan);
  return { intro: t.intro, lines, note: t.note };
}

/** Everything the template needs to render one variant of a report version. */
export async function buildReportDocument(
  db: Database,
  reportId: string,
  variant: ReportVariant,
): Promise<ReportDocument> {
  const { report, audit, client } = await loadReport(db, reportId);
  const [profile, findings, channels, scans, competitors, plan, agency] = await Promise.all([
    db.query.prospectProfiles.findFirst({ where: eq(prospectProfiles.clientId, client.id) }),
    usableFindings(db, audit.id),
    db.select().from(auditChannelStates).where(eq(auditChannelStates.auditId, audit.id)),
    db.select().from(siteScans).where(eq(siteScans.auditId, audit.id)),
    db
      .select({ id: auditCompetitors.id })
      .from(auditCompetitors)
      .where(and(eq(auditCompetitors.auditId, audit.id), eq(auditCompetitors.status, "confirmed"))),
    db.query.auditPlans.findFirst({ where: eq(auditPlans.auditId, audit.id) }),
    db.query.appSettings.findFirst({ where: eq(appSettings.key, "agency") }),
  ]);
  const excluded = new Set(report.excludedFindingIds);
  const included = findings.filter((f) => !excluded.has(f.id));
  const titles = new Map(included.map((f) => [f.id, f.title]));
  const grouped = groupFindings(included);
  const language = lang(profile?.reportLanguage);
  const keys = variant === "compact" ? new Set(COMPACT_REPORT_SECTIONS) : null;
  const acceptedPlan = plan && (plan.status === "accepted" || plan.status === "edited");
  const toItem = (f: FindingRow): ReportDocItem => ({
    id: f.id,
    kind: f.kind,
    title: f.title,
    description: f.kind === "comparison" ? (f.comparison?.rationale ?? null) : f.description,
    impact: f.impact,
    recommendation: f.recommendation,
    priority: f.priority,
    evidence: evidenceOf(f)
      .map((e) => e.label)
      .filter((l, i, a): l is string => Boolean(l) && a.indexOf(l) === i)
      .slice(0, 4),
    causes: f.parentIds.map((id) => titles.get(id)).filter((t): t is string => Boolean(t)),
  });
  const sections: ReportDocSection[] = report.sections
    .filter((s) => s.enabled && (!keys || keys.has(s.key)))
    .map((s) => {
      const base = { key: s.key, title: s.title, intro: s.intro, bullets: s.bullets, note: "" };
      if (s.key === "method") {
        const m = methodText(language, {
          channels,
          scans,
          competitors: competitors.length,
          skipped: audit.competitorsSkipped,
          plan: Boolean(acceptedPlan),
        });
        return { ...base, intro: s.intro || m.intro, bullets: m.lines, note: m.note, items: [] };
      }
      if (s.key === "cover" || s.key === "overview") return { ...base, items: [] };
      if (s.key === "next_steps") {
        const pillars = acceptedPlan ? plan.pillars.map((p) => `${p.name}: ${p.goal}`) : [];
        return { ...base, bullets: [...s.bullets, ...pillars], items: [] };
      }
      return { ...base, items: grouped[s.key].map(toItem) };
    });
  const agencyValue = (agency?.value ?? null) as { name?: string } | null;
  return {
    language,
    agency: { name: agencyValue?.name ?? null },
    prospect: { name: client.name, websiteUrl: client.websiteUrl },
    version: report.version,
    status: report.status,
    variant,
    date: (report.approvedAt ?? report.updatedAt).toISOString().slice(0, 10),
    sections,
  };
}

/** Deterministic PDF name: `rossi-srl_audit_2026-10-05_v2_full.pdf`. */
export function reportFileName(input: {
  slug: string;
  auditDate: Date;
  version: number;
  variant: ReportVariant;
  final: boolean;
}): string {
  const day = input.auditDate.toISOString().slice(0, 10);
  const v = input.variant === "full" ? "full" : "compact";
  return `${input.slug}_audit_${day}_v${input.version}_${v}${input.final ? "" : "_draft"}.pdf`;
}

// ---------------------------------------------------------------- Queries

export async function listReports(db: Database, auditId: string) {
  return db
    .select()
    .from(auditReports)
    .where(eq(auditReports.auditId, auditId))
    .orderBy(desc(auditReports.version));
}

export async function reportExports(db: Database, reportId: string) {
  return db
    .select()
    .from(auditReportExports)
    .where(eq(auditReportExports.reportId, reportId))
    .orderBy(desc(auditReportExports.createdAt));
}

/** Findings available to the report, grouped by section, with their exclusion flag. */
export async function reportFindings(
  db: Database,
  report: Pick<ReportRow, "auditId" | "excludedFindingIds">,
) {
  const excluded = new Set(report.excludedFindingIds);
  const grouped = groupFindings(await usableFindings(db, report.auditId));
  return Object.fromEntries(
    Object.entries(grouped).map(([k, list]) => [
      k,
      list.map((f) => ({ finding: f, excluded: excluded.has(f.id) })),
    ]),
  ) as Record<ReportSectionKey, Array<{ finding: FindingRow; excluded: boolean }>>;
}
