import { getCompetitorView } from "@forgecy/audit";
import { AUDIT_LIMITS } from "@forgecy/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { ListChecks, Pencil, SkipForward } from "lucide-react";
import { confirmCompetitorListAction, reopenCompetitorListAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { AddCompetitor, CompetitorItem, ProposalRequest } from "../../_components/competitor-tools";
import { FindingCard } from "../../_components/finding-card";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import { formatDateTime } from "../../_lib/labels";

export const metadata = { title: "Audit · Competitor" };

export default async function CompetitorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, client, readOnly, aiAllowed } = await sectionContext(slug);
  const view = await getCompetitorView(db, audit.id);
  const links = await sourceLinks(db, view.findings);
  const active = view.competitors.filter((c) => c.status !== "removed");
  const confirmed = Boolean(audit.competitorsConfirmedAt);
  const companies = [
    ...(view.prospectScan?.extracted?.offer
      ? [{ name: `${client.name} (prospect)`, ex: view.prospectScan.extracted }]
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
          <CardTitle>Lista dei competitor</CardTitle>
          <CardDescription>
            {audit.competitorsSkipped
              ? "Hai scelto di proseguire senza competitor: il report non avrà questa sezione."
              : confirmed
                ? `Lista confermata il ${formatDateTime(audit.competitorsConfirmedAt)}. Di ogni sito si leggono fino a ${AUDIT_LIMITS.maxCompetitorPages} pagine: home, servizi e contatti.`
                : `Fino a ${AUDIT_LIMITS.maxCompetitors} competitor diretti. Le proposte dell'AI vanno controllate: conferma la lista quando è giusta.`}
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
                  removedReason: c.removedReason,
                  sourceStatus: c.sourceStatus,
                  sourceError: c.sourceError,
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-fg-muted">
            {aiAllowed
              ? "Nessun competitor ancora. Lo Strategist li propone dopo la lettura del sito, oppure aggiungili tu."
              : "Aggiungi i competitor che conosci."}
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
                  Modifica lista
                </ActionButton>
              ) : (
                <>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, false)}
                    icon={<ListChecks aria-hidden />}
                    variant="primary"
                    confirm="Confermare la lista? Le proposte ancora aperte diventano confermate e i loro siti vengono letti."
                  >
                    Conferma lista
                  </ActionButton>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, true)}
                    icon={<SkipForward aria-hidden />}
                    variant="ghost"
                  >
                    Prosegui senza competitor
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
            <CardTitle>A confronto</CardTitle>
            <CardDescription>
              Offerta e tono letti sulle pagine; la frase è citata parola per parola.
            </CardDescription>
          </CardHeader>
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Offerta e tono di prospect e competitor</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Azienda
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Offerta principale
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Tono
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  CTA principale
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
        </Card>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">Osservazioni sui competitor</h2>
          {!readOnly ? (
            <AddFinding auditId={audit.id} channel="website" areas={["competitors"]} />
          ) : null}
        </div>
        {view.findings.length ? (
          view.findings.map((f) => (
            <FindingCard key={f.id} finding={toView(f)} sources={links} readOnly={readOnly} />
          ))
        ) : (
          <p className="text-body-md text-fg-muted">
            {confirmed
              ? "Le osservazioni arrivano dopo la lettura dei siti dei competitor."
              : "Conferma la lista per avviare il confronto."}
          </p>
        )}
      </section>
    </div>
  );
}
