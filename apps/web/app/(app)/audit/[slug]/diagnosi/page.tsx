import { getDiagnosisView } from "@forgecy/audit";
import { AUDIT_LIMITS, findingAreas, type FindingArea } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { ArrowDown, ArrowUp, Check, RefreshCw, Sparkles, X } from "lucide-react";
import {
  moveProblemAction,
  requestDiagnosisAction,
  requestPlanAction,
  reviewPlanAction,
} from "../../actions";
import { ActionButton } from "../../_components/action-button";
import { AddFinding } from "../../_components/add-finding";
import { FindingCard } from "../../_components/finding-card";
import { sectionContext, sourceLinks, toView } from "../../_lib/findings";
import { channelLabel, findingStatusLabel, findingStatusVariant } from "../../_lib/labels";

export const metadata = { title: "Audit · Diagnosi" };

export default async function DiagnosisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, aiAllowed } = await sectionContext(slug);
  const { problems, observations, plan } = await getDiagnosisView(db, audit.id);
  const links = await sourceLinks(db, problems);
  const live = problems.filter((p) => p.status !== "rejected");
  const usable = problems.filter((p) => p.status === "accepted" || p.status === "edited");
  const titles = new Map(observations.map((o) => [o.id, o.title]));
  const outdated = Boolean(
    audit.diagnosisAt && audit.findingsChangedAt && audit.findingsChangedAt > audit.diagnosisAt,
  );
  const canEdit = !readOnly;

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Problemi principali</CardTitle>
          <CardDescription>
            Da {AUDIT_LIMITS.minProblems} a {AUDIT_LIMITS.maxProblems} problemi, ognuno legato alle
            osservazioni accettate che lo provano. L&apos;ordine è quello del report.
          </CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          {observations.length} osservazioni utilizzabili · {usable.length} problemi accettati
        </p>
        {outdated ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            Le osservazioni sono cambiate dopo l&apos;ultima diagnosi: i problemi segnati “Da
            ricontrollare” vanno rivisti.
          </p>
        ) : null}
        {canEdit && aiAllowed ? (
          observations.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestDiagnosisAction.bind(null, audit.id)}
                icon={audit.diagnosisAt ? RefreshCw : Sparkles}
                variant="primary"
                confirm={
                  audit.diagnosisAt
                    ? "I problemi proposti e non ancora rivisti vengono sostituiti. Continuare?"
                    : undefined
                }
              >
                {audit.diagnosisAt ? "Aggiorna la diagnosi" : "Genera la diagnosi"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Accetta almeno un&apos;osservazione su sito, social o competitor per chiedere la
              diagnosi.
            </p>
          )
        ) : null}
        {!aiAllowed ? (
          <p className="text-body-sm text-fg-muted">
            La policy di questo prospect non permette l&apos;AI: scrivi tu i problemi collegandoli
            alle osservazioni accettate.
          </p>
        ) : null}
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">Problemi</h2>
          {canEdit && live.length < AUDIT_LIMITS.maxProblems && observations.length ? (
            <AddFinding
              auditId={audit.id}
              kind="problem"
              areas={[...findingAreas] as FindingArea[]}
              observations={observations.map((o) => ({ id: o.id, title: o.title }))}
            />
          ) : null}
        </div>
        {problems.length ? (
          problems.map((p, i) => (
            <div key={p.id} className="flex flex-col gap-2">
              <FindingCard finding={toView(p)} sources={links} readOnly={readOnly} />
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-body-sm text-fg-muted">
                  {p.parentIds.length
                    ? `Collegato a: ${p.parentIds
                        .map((id) => titles.get(id) ?? "osservazione non più utilizzabile")
                        .join(" · ")}`
                    : "Nessuna osservazione collegata"}
                </p>
                {canEdit && p.status !== "rejected" ? (
                  <div className="flex gap-1">
                    {i > 0 ? (
                      <ActionButton
                        action={moveProblemAction.bind(null, p.id, "up")}
                        icon={ArrowUp}
                        variant="ghost"
                        size="sm"
                      >
                        Su
                      </ActionButton>
                    ) : null}
                    {i < problems.length - 1 ? (
                      <ActionButton
                        action={moveProblemAction.bind(null, p.id, "down")}
                        icon={ArrowDown}
                        variant="ghost"
                        size="sm"
                      >
                        Giù
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="text-body-md text-fg-muted">Nessun problema ancora.</p>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Piano di 30 giorni</CardTitle>
          <CardDescription>
            Una proposta di pilastri e contenuti che risponde ai problemi accettati. Resta una
            proposta finché non la accetti.
          </CardDescription>
        </CardHeader>
        {canEdit && aiAllowed ? (
          usable.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestPlanAction.bind(null, audit.id)}
                icon={plan ? RefreshCw : Sparkles}
                variant={plan ? "secondary" : "primary"}
                confirm={plan ? "Il piano attuale viene sostituito. Continuare?" : undefined}
              >
                {plan ? "Rigenera il piano" : "Genera il piano"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Accetta almeno un problema per chiedere il piano.
            </p>
          )
        ) : null}
        {plan ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={findingStatusVariant[plan.status]}>
                {findingStatusLabel[plan.status]}
              </Badge>
              {plan.authorAgent ? (
                <span className="text-body-sm text-fg-muted">Proposto dallo Strategist</span>
              ) : null}
            </div>
            {plan.pillars.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {plan.pillars.map((pl) => (
                  <li key={pl.name} className="rounded-md border border-subtle p-3">
                    <p className="text-heading-sm text-fg">{pl.name}</p>
                    <p className="text-body-sm">{pl.goal}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.items.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-sm">
                  <caption className="sr-only">Calendario dei contenuti proposti</caption>
                  <thead className="border-b border-subtle text-label text-fg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Giorno
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Canale
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Formato
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Pilastro
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Tema e gancio
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plan.items]
                      .sort((a, b) => a.day - b.day)
                      .map((it, idx) => (
                        <tr
                          key={`${it.day}-${idx}`}
                          className="border-b border-subtle align-top last:border-0"
                        >
                          <td className="px-3 py-2 font-mono">{it.day}</td>
                          <td className="px-3 py-2">{channelLabel[it.channel]}</td>
                          <td className="px-3 py-2">{it.format}</td>
                          <td className="px-3 py-2">{it.pillar}</td>
                          <td className="px-3 py-2">
                            {it.topic}
                            <span className="block text-fg-muted">{it.hook}</span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {canEdit && plan.status !== "accepted" ? (
              <div className="flex flex-wrap gap-3">
                <ActionButton
                  action={reviewPlanAction.bind(null, audit.id, "accept")}
                  icon={Check}
                  variant="primary"
                >
                  Accetta il piano
                </ActionButton>
                {plan.status !== "rejected" ? (
                  <ActionButton
                    action={reviewPlanAction.bind(null, audit.id, "reject")}
                    icon={X}
                    variant="ghost"
                  >
                    Scarta
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
