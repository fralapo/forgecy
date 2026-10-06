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
import { plural } from "@/lib/plural";

export const metadata = { title: "Audit · Diagnosis" };

export default async function DiagnosisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, aiAllowed } = await sectionContext(slug);
  const { problems, observations, plan, outcome } = await getDiagnosisView(db, audit.id);
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
          <CardTitle>Main problems</CardTitle>
          <CardDescription>
            From {AUDIT_LIMITS.minProblems} to {AUDIT_LIMITS.maxProblems} problems, each linked to
            the accepted observations that prove it. The order is the one used in the report.
          </CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          {plural(observations.length, "usable observation", "usable observations")} ·{" "}
          {plural(usable.length, "accepted problem", "accepted problems")}
        </p>
        {outdated ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            The observations changed after the last diagnosis: problems marked “To recheck” need
            reviewing.
          </p>
        ) : null}
        {outcome && outcome.withoutEvidence > 0 ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            Rejected because not linked to accepted observations: {outcome.withoutEvidence} of{" "}
            {plural(outcome.proposed, "problem proposed", "problems proposed")} by the last
            diagnosis.
          </p>
        ) : null}
        {canEdit && aiAllowed ? (
          observations.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestDiagnosisAction.bind(null, audit.id)}
                icon={audit.diagnosisAt ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
                variant="primary"
                confirm={
                  audit.diagnosisAt
                    ? "Proposed problems not yet reviewed will be replaced. Continue?"
                    : undefined
                }
              >
                {audit.diagnosisAt ? "Update the diagnosis" : "Generate the diagnosis"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Accept at least one observation on the website, social channels or competitors to
              request the diagnosis.
            </p>
          )
        ) : null}
        {!aiAllowed ? (
          <p className="text-body-sm text-fg-muted">
            This prospect’s policy does not allow AI: write the problems yourself, linking them to
            the accepted observations.
          </p>
        ) : null}
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">Problems</h2>
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
                    ? `Linked to: ${p.parentIds
                        .map((id) => titles.get(id) ?? "observation no longer usable")
                        .join(" · ")}`
                    : "No linked observations"}
                </p>
                {canEdit && p.status !== "rejected" ? (
                  <div className="flex gap-1">
                    {i > 0 ? (
                      <ActionButton
                        action={moveProblemAction.bind(null, p.id, "up")}
                        icon={<ArrowUp aria-hidden />}
                        variant="ghost"
                        size="sm"
                      >
                        Up
                      </ActionButton>
                    ) : null}
                    {i < problems.length - 1 ? (
                      <ActionButton
                        action={moveProblemAction.bind(null, p.id, "down")}
                        icon={<ArrowDown aria-hidden />}
                        variant="ghost"
                        size="sm"
                      >
                        Down
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="text-body-md text-fg-muted">
            {outcome && outcome.proposed > 0
              ? "No usable problems from the last diagnosis. You can update it or write the problems yourself."
              : outcome
                ? "The last diagnosis proposed no problems. You can update it or write the problems yourself."
                : "No problems yet."}
          </p>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>30-day plan</CardTitle>
          <CardDescription>
            A proposal of pillars and content that addresses the accepted problems. It stays a
            proposal until you accept it.
          </CardDescription>
        </CardHeader>
        {canEdit && aiAllowed ? (
          usable.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestPlanAction.bind(null, audit.id)}
                icon={plan ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
                variant={plan ? "secondary" : "primary"}
                confirm={plan ? "The current plan will be replaced. Continue?" : undefined}
              >
                {plan ? "Regenerate the plan" : "Generate the plan"}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">
              Accept at least one problem to request the plan.
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
                <span className="text-body-sm text-fg-muted">Proposed by the Strategist</span>
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
                  <caption className="sr-only">Calendar of proposed content</caption>
                  <thead className="border-b border-subtle text-label text-fg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Day
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Channel
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Format
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Pillar
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Topic and hook
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
                  icon={<Check aria-hidden />}
                  variant="primary"
                >
                  Accept the plan
                </ActionButton>
                {plan.status !== "rejected" ? (
                  <ActionButton
                    action={reviewPlanAction.bind(null, audit.id, "reject")}
                    icon={<X aria-hidden />}
                    variant="ghost"
                  >
                    Reject
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
