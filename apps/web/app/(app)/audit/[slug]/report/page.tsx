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
import { fileUrl } from "../../_lib/server";
import {
  formatDateTime,
  levelLabel,
  reportStatusLabel,
  reportStatusVariant,
} from "../../_lib/labels";
import { plural } from "@/lib/plural";

export const metadata = { title: "Audit · Report" };

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const { db, audit, aiAllowed } = await sectionContext(slug);
  const reports = await listReports(db, audit.id);
  const current = reports[0];
  const closed = audit.status === "archived";

  if (!current) {
    const readiness = await reportReadiness(db, audit.id);
    const ready = readiness.every((r) => r.ok);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report</CardTitle>
          <CardDescription>
            Il report raccoglie i problemi, le osservazioni accettate e i prossimi passi. Lo componi
            da qui, lo mandi in revisione e lo esporti in PDF dopo l&apos;approvazione di una
            persona.
          </CardDescription>
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
                {r.label}
                {r.detail ? <span className="text-fg-muted"> · {r.detail}</span> : null}
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
              Componi report
            </ActionButton>
            {aiAllowed ? (
              <p className="mt-2 text-body-sm text-fg-muted">
                Strategist e Copywriter propongono i testi e l&apos;email: li rivedi tu prima della
                revisione.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-body-sm text-fg-muted">
            Completa i passi qui sopra per comporre il report.
          </p>
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
            Modifiche richieste: {current.changesRequested}
          </p>
        ) : null}
        {outdated && draft ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            Le osservazioni sono cambiate dopo la composizione: controlla elementi e testi.
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
                  confirm="Strategist e Copywriter riscrivono i testi non modificati a mano e l'email. Continuare?"
                >
                  Proponi i testi con l&apos;AI
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
              <CardTitle>Contenuto del report</CardTitle>
              <CardDescription>
                Questa versione non si modifica più
                {current.status === "in_review" ? ": ritirala dalla revisione per cambiarla." : "."}
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
                              · priorità {levelLabel[it.priority].toLowerCase()}
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
                  Email di accompagnamento
                </summary>
                <p className="mt-2 text-body-sm font-medium">{current.emailSubject}</p>
                <p className="whitespace-pre-line text-body-sm">{current.emailBody}</p>
              </details>
            ) : (
              <p className="text-body-sm text-fg-muted">
                Nessuna email di accompagnamento in questa versione.
              </p>
            )}
          </Card>
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Versione {current.version}</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={reportStatusVariant[current.status]}>
              {reportStatusLabel[current.status]}
            </Badge>
            <span className="text-body-sm text-fg-muted">
              Aggiornata il {formatDateTime(current.updatedAt)}
            </span>
          </div>
          {current.approvedAt ? (
            <p className="text-body-sm">
              Approvata il {formatDateTime(current.approvedAt)}
              {current.approvalNote ? ` · ${current.approvalNote}` : ""}
            </p>
          ) : null}
          {!closed && draft ? (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={submitReportAction.bind(null, { id: current.id, rev: current.rev })}
                icon={<Send aria-hidden />}
                variant="primary"
              >
                Invia in revisione
              </ActionButton>
              {!current.submittedAt ? (
                <ActionButton
                  action={deleteReportDraftAction.bind(null, current.id)}
                  icon={<Trash2 aria-hidden />}
                  variant="ghost"
                  confirm="Eliminare questa bozza del report?"
                >
                  Elimina bozza
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
                Ritira dalla revisione
              </ActionButton>
            </>
          ) : null}
          {canCompose ? (
            <ActionButton
              action={composeReportAction.bind(null, audit.id)}
              icon={<RefreshCw aria-hidden />}
              variant="secondary"
            >
              Crea una nuova versione
            </ActionButton>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>PDF</CardTitle>
            <CardDescription>
              Il PDF usa il template «Report di audit». Le prove hanno la filigrana «Bozza»; il PDF
              finale si esporta dopo l&apos;approvazione e consegna l&apos;audit.
            </CardDescription>
          </CardHeader>
          {exportFailure ? (
            <p role="alert" className="text-body-sm text-error">
              L&apos;ultimo PDF non è stato creato
              {exportFailure.error ? `: ${exportFailure.error}` : "."}
            </p>
          ) : null}
          {current.status !== "superseded" ? (
            <div className="flex flex-wrap gap-2">
              {(["full", "compact"] as const).map((variant) => (
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
                  {variant === "full" ? "Prova completa" : "Prova compatta"}
                </ActionButton>
              ))}
            </div>
          ) : null}
          {!closed && (current.status === "approved" || current.status === "exported") ? (
            <div className="flex flex-wrap gap-2">
              {(["full", "compact"] as const).map((variant) => (
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
                      ? "Il PDF finale consegna l'audit: dopo non si modifica più. Continuare?"
                      : undefined
                  }
                >
                  {variant === "full" ? "PDF finale completo" : "PDF finale compatto"}
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
                    {d.final ? "Finale" : "Bozza"} · {plural(d.pages, "pagina", "pagine")} ·{" "}
                    {formatDateTime(d.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Verifica delle evidenze</CardTitle>
            <CardDescription>
              Ogni elemento incluso deve avere una fonte che esiste ancora.
            </CardDescription>
          </CardHeader>
          {check.ok ? (
            <p className="flex items-center gap-2 text-body-sm">
              <Check aria-hidden className="size-4 text-success" />
              {plural(check.included, "elemento", "elementi")}, tutti con evidenza
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {check.errors.map((e) => (
                <li key={e.findingId} className="text-body-sm">
                  <span className="text-error">{e.title}</span>
                  <span className="text-fg-muted">
                    {" "}
                    · {titleOf.get(e.section) ?? e.section}: {e.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {check.warnings.length ? (
            <ul className="flex flex-col gap-1">
              {check.warnings.map((w) => (
                <li key={w.section + w.message} className="text-body-sm text-fg-muted">
                  {titleOf.get(w.section) ?? w.section}: {w.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {reports.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Versioni precedenti</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-2">
              {reports.slice(1).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-body-sm">
                  <span>
                    v{r.version} · {formatDateTime(r.updatedAt)}
                  </span>
                  <Badge variant={reportStatusVariant[r.status]}>
                    {reportStatusLabel[r.status]}
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
