import {
  auditJobStates,
  auditReportExportJob,
  buildReportDocument,
  checkReportEvidence,
  listReports,
  reportExports,
  reportFindings,
  reportReadiness,
} from "@forgecy/audit";
import type { ReportSectionKey } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import {
  Check,
  CircleDashed,
  FileCheck2,
  FileDown,
  FilePlus2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getFormat, refText } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import {
  composeReportAction,
  deleteReportDraftAction,
  requestReportExportAction,
  requestReportTextsAction,
  submitReportAction,
  withdrawReportAction,
} from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { ReportEditor, type ReportFindingView } from "../../_components/report-editor";
import { ReportReview } from "../../_components/report-review";
import { sectionContext } from "../../_lib/findings";
import { readinessDetail, readinessLabel } from "../../_lib/readiness";
import { fileUrl } from "../../_lib/server";
import { reportStatusVariant } from "../../_lib/labels";

export async function generateMetadata() {
  const t = await getTranslations("audit.report");
  return { title: t("metaTitle") };
}

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const { db, audit, aiAllowed } = await sectionContext(slug);
  const reports = await listReports(db, audit.id);
  const current = reports[0];
  const closed = audit.status === "archived";
  const t = await getTranslations("audit");
  const format = await getFormat();

  if (!current) {
    const readiness = await reportReadiness(db, audit.id);
    const ready = readiness.every((r) => r.ok);
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("report.title")}</CardTitle>
          <CardDescription>{t("report.intro")}</CardDescription>
        </CardHeader>
        <ul className="flex flex-col gap-2">
          {readiness.map((r) => (
            <li key={r.key} className="flex items-start gap-2 text-body-sm">
              {r.ok ? (
                <Check aria-hidden className="mt-0.5 size-4 text-success" />
              ) : (
                <CircleDashed aria-hidden className="mt-0.5 size-4 text-fg-muted" />
              )}
              <span>
                {readinessLabel(t, r)}
                {r.detail ? (
                  <span className="text-fg-muted"> · {readinessDetail(t, r)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {closed ? null : ready ? (
          <div>
            <ActionButton
              action={composeReportAction.bind(null, audit.id)}
              icon={<FilePlus2 aria-hidden />}
              variant="primary"
            >
              {t("report.compose")}
            </ActionButton>
            {aiAllowed ? (
              <p className="mt-2 text-body-sm text-fg-muted">{t("report.composeAiHint")}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-body-sm text-fg-muted">{t("report.completeSteps")}</p>
        )}
      </Card>
    );
  }

  const [grouped, check, doc, exports, jobs] = await Promise.all([
    reportFindings(db, current),
    checkReportEvidence(db, current),
    buildReportDocument(db, current.id, "full"),
    reportExports(db, current.id),
    auditJobStates(db, audit.id),
  ]);
  // The last PDF attempt, when it failed: shown next to the export buttons, not only in the job bar.
  const exportJob = jobs.find((j) => j.kind === auditReportExportJob.kind);
  const exportFailure =
    exportJob &&
    (exportJob.status === "failed" || exportJob.status === "needs_attention") &&
    !exports.some((e) => e.createdAt > exportJob.createdAt)
      ? exportJob
      : null;
  const downloads = await Promise.all(
    exports.slice(0, 6).map(async (e) => ({
      ...e,
      href: await fileUrl(e.storageKey, e.fileName),
    })),
  );
  const findings = Object.fromEntries(
    Object.entries(grouped).map(([k, list]) => [
      k,
      list.map(({ finding }): ReportFindingView => ({
        id: finding.id,
        title: finding.title,
        kind: finding.kind,
      })),
    ]),
  ) as Record<ReportSectionKey, ReportFindingView[]>;
  const titleOf = new Map(current.sections.map((s) => [s.key, s.title]));
  const draft = current.status === "draft";
  const outdated = Boolean(
    current.findingsAt && audit.findingsChangedAt && audit.findingsChangedAt > current.findingsAt,
  );
  const canCompose = !closed && (current.status === "approved" || current.status === "exported");

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        {current.changesRequested && draft ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            {t("report.changesRequested", { comment: current.changesRequested })}
          </p>
        ) : null}
        {outdated && draft ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            {t("report.outdated")}
          </p>
        ) : null}
        {draft && !closed ? (
          <>
            {aiAllowed ? (
              <div className="flex flex-wrap gap-3">
                <ActionButton
                  action={requestReportTextsAction.bind(null, {
                    reportId: current.id,
                    email: true,
                  })}
                  icon={<Sparkles aria-hidden />}
                  confirm={t("report.proposeTextsConfirm")}
                >
                  {t("report.proposeTexts")}
                </ActionButton>
              </div>
            ) : null}
            <ReportEditor
              key={current.id}
              report={{
                id: current.id,
                rev: current.rev,
                sections: current.sections,
                excludedFindingIds: current.excludedFindingIds,
                emailSubject: current.emailSubject,
                emailBody: current.emailBody,
                emailByAgent: current.emailByAgent,
              }}
              findings={findings}
            />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("report.content")}</CardTitle>
              <CardDescription>
                {current.status === "in_review" ? t("report.lockedInReview") : t("report.locked")}
              </CardDescription>
            </CardHeader>
            <ol className="flex flex-col gap-6">
              {doc.sections.map((s) => (
                <li key={s.key} className="flex flex-col gap-2">
                  <h3 className="text-heading-sm text-fg">{s.title}</h3>
                  {s.intro ? <p className="text-body-md">{s.intro}</p> : null}
                  {s.bullets.length ? (
                    <ul className="list-disc pl-5 text-body-sm">
                      {s.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                  {s.items.length ? (
                    <ul className="flex flex-col gap-2">
                      {s.items.map((it) => (
                        <li key={it.id} className="rounded-md border border-subtle p-3">
                          <p className="text-body-md text-fg">
                            {it.title}{" "}
                            <span className="text-body-sm text-fg-muted">
                              {t("report.itemPriority", {
                                priority: t(`level.${it.priority}`).toLowerCase(),
                              })}
                            </span>
                          </p>
                          {it.description ? <p className="text-body-sm">{it.description}</p> : null}
                          {it.recommendation ? (
                            <p className="text-body-sm text-fg-muted">{it.recommendation}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
            {current.emailBody ? (
              <details>
                <summary className="cursor-pointer text-body-sm text-link">
                  {t("report.coverEmail")}
                </summary>
                <p className="mt-2 text-body-sm font-medium">{current.emailSubject}</p>
                <p className="whitespace-pre-line text-body-sm">{current.emailBody}</p>
              </details>
            ) : (
              <p className="text-body-sm text-fg-muted">{t("report.noCoverEmail")}</p>
            )}
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("report.version", { version: current.version })}</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={reportStatusVariant[current.status]}>
              {t(`reportStatus.${current.status}`)}
            </Badge>
            <span className="text-body-sm text-fg-muted">
              {t("report.updatedOn", { date: format.date(current.updatedAt, "dateTime") })}
            </span>
          </div>
          {current.approvedAt ? (
            <p className="text-body-sm">
              {current.approvalNote
                ? t("report.approvedOnWithNote", {
                    date: format.date(current.approvedAt, "dateTime"),
                    note: current.approvalNote,
                  })
                : t("report.approvedOn", { date: format.date(current.approvedAt, "dateTime") })}
            </p>
          ) : null}
          {!closed && draft ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={submitReportAction.bind(null, { id: current.id, rev: current.rev })}
                icon={<Send aria-hidden />}
                variant="primary"
              >
                {t("report.submit")}
              </ActionButton>
              {!current.submittedAt ? (
                <ActionButton
                  action={deleteReportDraftAction.bind(null, current.id)}
                  icon={<Trash2 aria-hidden />}
                  variant="ghost"
                  confirm={t("report.deleteDraftConfirm")}
                >
                  {t("report.deleteDraft")}
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          {!closed && current.status === "in_review" ? (
            <>
              <ReportReview
                id={current.id}
                rev={current.rev}
                ownSubmission={current.submittedBy === user.id}
              />
              <ActionButton
                action={withdrawReportAction.bind(null, current.id, current.rev)}
                icon={<Undo2 aria-hidden />}
                variant="ghost"
              >
                {t("report.withdraw")}
              </ActionButton>
            </>
          ) : null}
          {canCompose ? (
            <ActionButton
              action={composeReportAction.bind(null, audit.id)}
              icon={<RefreshCw aria-hidden />}
              variant="secondary"
            >
              {t("report.newVersion")}
            </ActionButton>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("report.pdf")}</CardTitle>
            <CardDescription>{t("report.pdfDescription")}</CardDescription>
          </CardHeader>
          {exportFailure ? (
            <p role="alert" className="text-body-sm text-error">
              {exportFailure.error
                ? t("report.exportFailedWithError", {
                    error: await refText(exportFailure.errorRef, exportFailure.error),
                  })
                : t("report.exportFailed")}
            </p>
          ) : null}
          {current.status !== "superseded" ? (
            <div className="flex flex-wrap gap-2">
              {(["full", "compact", "strategy"] as const).map((variant) => (
                <ActionButton
                  key={`draft-${variant}`}
                  action={requestReportExportAction.bind(null, {
                    reportId: current.id,
                    variant,
                    final: false,
                  })}
                  icon={<FileDown aria-hidden />}
                  variant="ghost"
                  size="sm"
                >
                  {t(`report.proof.${variant}`)}
                </ActionButton>
              ))}
            </div>
          ) : null}
          {!closed && (current.status === "approved" || current.status === "exported") ? (
            <div className="flex flex-wrap gap-2">
              {(["full", "compact", "strategy"] as const).map((variant) => (
                <ActionButton
                  key={`final-${variant}`}
                  action={requestReportExportAction.bind(null, {
                    reportId: current.id,
                    variant,
                    final: true,
                  })}
                  icon={<FileCheck2 aria-hidden />}
                  variant={variant === "full" ? "primary" : "secondary"}
                  size="sm"
                  confirm={
                    current.status === "approved" && variant === "full"
                      ? t("report.finalConfirm")
                      : undefined
                  }
                >
                  {t(`report.final.${variant}`)}
                </ActionButton>
              ))}
            </div>
          ) : null}
          {downloads.length ? (
            <ul className="flex flex-col gap-2">
              {downloads.map((d) => (
                <li key={d.id} className="flex flex-col text-body-sm">
                  {d.href ? (
                    <a href={d.href} className="text-link underline-offset-2 hover:underline">
                      {d.fileName}
                    </a>
                  ) : (
                    <span>{d.fileName}</span>
                  )}
                  <span className="text-fg-muted">
                    {t("report.exportMeta", {
                      kind: t(d.final ? "report.exportKind.final" : "report.exportKind.draft"),
                      pages: d.pages,
                      date: format.date(d.createdAt, "dateTime"),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("report.evidence")}</CardTitle>
            <CardDescription>{t("report.evidenceDescription")}</CardDescription>
          </CardHeader>
          {check.ok ? (
            <p className="flex items-center gap-2 text-body-sm">
              <Check aria-hidden className="size-4 text-success" />
              {t("report.evidenceOk", { count: check.included })}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {check.errors.map((e) => (
                <li key={e.findingId} className="text-body-sm">
                  <span className="text-error">{e.title}</span>
                  <span className="text-fg-muted">
                    {t("report.evidenceIssue", {
                      section: titleOf.get(e.section) ?? e.section,
                      reason: t(`report.evidenceReason.${e.code}`),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {check.warnings.length ? (
            <ul className="flex flex-col gap-1">
              {check.warnings.map((w) => (
                <li key={w.section + w.code} className="text-body-sm text-fg-muted">
                  {t("report.warning", {
                    section: titleOf.get(w.section) ?? w.section,
                    message: t(`report.warningMessage.${w.code}`),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {reports.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("report.previousVersions")}</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {reports.slice(1).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-body-sm">
                  <span>
                    {t("report.previousVersion", {
                      version: r.version,
                      date: format.date(r.updatedAt, "dateTime"),
                    })}
                  </span>
                  <Badge variant={reportStatusVariant[r.status]}>
                    {t(`reportStatus.${r.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
