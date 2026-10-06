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

export const metadata = { title: "Audit · Competitors" };

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
          <CardTitle>Competitor list</CardTitle>
          <CardDescription>
            {audit.competitorsSkipped
              ? "You chose to continue without competitors: the report will not have this section."
              : confirmed
                ? `List confirmed on ${formatDateTime(audit.competitorsConfirmedAt)}. Up to ${AUDIT_LIMITS.maxCompetitorPages} pages are read from each website: home, services and contacts.`
                : `Up to ${AUDIT_LIMITS.maxCompetitors} direct competitors. The AI's proposals need checking: confirm the list when it is right.`}
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
              ? "No competitors yet. The Strategist proposes them after the website is read, or add them yourself."
              : "Add the competitors you know."}
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
                  Edit list
                </ActionButton>
              ) : (
                <>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, false)}
                    icon={<ListChecks aria-hidden />}
                    variant="primary"
                    confirm="Confirm the list? Proposals still open become confirmed and their websites are read."
                  >
                    Confirm list
                  </ActionButton>
                  <ActionButton
                    action={confirmCompetitorListAction.bind(null, audit.id, true)}
                    icon={<SkipForward aria-hidden />}
                    variant="ghost"
                  >
                    Continue without competitors
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
            <CardTitle>Side by side</CardTitle>
            <CardDescription>
              Offer and tone read on the pages; the sentence is quoted word for word.
            </CardDescription>
          </CardHeader>
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">Offer and tone of the prospect and competitors</caption>
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Company
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Main offer
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Tone
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Main CTA
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
          <h2 className="font-display text-heading-md text-fg">Competitor observations</h2>
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
              ? "Observations arrive after the competitors’ websites are read."
              : "Confirm the list to start the comparison."}
          </p>
        )}
      </section>
    </div>
  );
}
