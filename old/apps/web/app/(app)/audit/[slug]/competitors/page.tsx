import { getCompetitorView } from "@forgecy/audit";
import { AUDIT_LIMITS } from "@forgecy/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { ListChecks, Pencil, SkipForward } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { confirmCompetitorListAction, reopenCompetitorListAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { AddCompetitor, CompetitorItem, ProposalRequest } from "../../_components/competitor-tools";
import { FindingCard } from "../../_components/finding-card";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import { getFormat } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getTranslations("audit.competitors");
  return { title: t("metaTitle") };
}

export default async function CompetitorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, client, readOnly, aiAllowed, rt } = await sectionContext(slug);
  const view = await getCompetitorView(db, audit.id);
  const links = await sourceLinks(db, view.findings);
  const t = await getTranslations("audit.competitors");
  const format = await getFormat();
  const active = view.competitors.filter((c) => c.status !== "removed");
  const confirmed = Boolean(audit.competitorsConfirmedAt);
  const companies = [
    ...(view.prospectScan?.extracted?.offer
      ? [{ name: t("prospectName", { name: client.name }), ex: view.prospectScan.extracted }]
      : []),
    ...view.competitors
      .filter((c) => c.status === "confirmed")
      .map((c) => ({ name: c.name, ex: view.latestScan.get(c.id)?.extracted ?? null }))
      .filter((c) => c.ex?.offer),
  ];

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {audit.competitorsSkipped
              ? t("skipped")
              : confirmed
                ? t("confirmed", {
                    date: audit.competitorsConfirmedAt
                      ? format.date(audit.competitorsConfirmedAt, "dateTime")
                      : "—",
                    pages: AUDIT_LIMITS.maxCompetitorPages,
                  })
                : t("intro", { max: AUDIT_LIMITS.maxCompetitors })}
          </CardDescription>
        </CardHeader>
        {view.competitors.length ? (
          <ul className="flex flex-col gap-3">
            {view.competitors.map((c) => (
              <CompetitorItem
                key={c.id}
                readOnly={readOnly}
                c={{
                  id: c.id,
                  name: c.name,
                  websiteUrl: c.websiteUrl,
                  reason: c.reason,
                  confidence: c.confidence,
                  proposedByAgent: c.proposedByAgent,
                  status: c.status,
                  removedReason: c.removedReason ? rt(c.removedRef, c.removedReason) : null,
                  sourceStatus: c.sourceStatus,
                  sourceError: c.sourceError ? rt(c.sourceErrorRef, c.sourceError) : null,
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-fg-muted">
            {aiAllowed ? t("emptyAi") : t("emptyManual")}
          </p>
        )}
        {!readOnly ? (
          <div className="flex flex-col gap-4 border-t border-subtle pt-4">
            {active.length < AUDIT_LIMITS.maxCompetitors ? (
              <AddCompetitor auditId={audit.id} />
            ) : null}
            {aiAllowed && !confirmed ? (
              <ProposalRequest
                auditId={audit.id}
                hasProposals={view.competitors.some((c) => c.proposedByAgent)}
              />
            ) : null}
            <div className="flex flex-wrap gap-3">
              {confirmed || audit.competitorsSkipped ? (
                <ActionButton
                  action={reopenCompetitorListAction.bind(null, audit.id)}
                  icon={<Pencil aria-hidden />}
                >
                  {t("editList")}
                </ActionButton>
              ) : (
                <>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, false)}
                    icon={<ListChecks aria-hidden />}
                    variant="primary"
                    confirm={t("confirmListQuestion")}
                  >
                    {t("confirmList")}
                  </ActionButton>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, true)}
                    icon={<SkipForward aria-hidden />}
                    variant="ghost"
                  >
                    {t("skip")}
                  </ActionButton>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      {companies.length ? (
        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>{t("sideBySide")}</CardTitle>
            <CardDescription>{t("sideBySideDescription")}</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">{t("sideBySideCaption")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("columns.company")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("columns.offer")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("columns.tone")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("columns.cta")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.name} className="border-b border-subtle last:border-0 align-top">
                    <th scope="row" className="px-3 py-2 font-medium text-fg">
                      {c.name}
                    </th>
                    <td className="px-3 py-2">{c.ex?.offer}</td>
                    <td className="px-3 py-2">
                      {c.ex?.tone}
                      {c.ex?.toneQuote ? (
                        <q className="block text-fg-muted">{c.ex.toneQuote}</q>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{c.ex?.ctas?.[0]?.text ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">{t("observations")}</h2>
          {!readOnly ? (
            <AddFinding auditId={audit.id} channel="website" areas={["competitors"]} />
          ) : null}
        </div>
        {view.findings.length ? (
          view.findings.map((f) => (
            <FindingCard key={f.id} finding={toView(f, rt)} sources={links} readOnly={readOnly} />
          ))
        ) : (
          <p className="text-body-md text-fg-muted">
            {confirmed ? t("observationsAfterRead") : t("confirmToStart")}
          </p>
        )}
      </section>
    </div>
  );
}
