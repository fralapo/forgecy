import { getDiagnosisView } from "@forgecy/audit";
import { AUDIT_LIMITS, findingAreas, type FindingArea } from "@forgecy/core";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@forgecy/ui";
import { ArrowDown, ArrowUp, Check, RefreshCw, Sparkles, X } from "lucide-react";
import { getTranslations } from "next-intl/server";
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
import { findingStatusVariant } from "../../_lib/labels";

export async function generateMetadata() {
  const t = await getTranslations("audit.diagnosis");
  return { title: t("metaTitle") };
}

export default async function DiagnosisPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db, audit, readOnly, aiAllowed, rt } = await sectionContext(slug);
  const { problems, observations, plan, outcome } = await getDiagnosisView(db, audit.id);
  const links = await sourceLinks(db, problems);
  const live = problems.filter((p) => p.status !== "rejected");
  const usable = problems.filter((p) => p.status === "accepted" || p.status === "edited");
  const titles = new Map(observations.map((o) => [o.id, o.title]));
  const outdated = Boolean(
    audit.diagnosisAt && audit.findingsChangedAt && audit.findingsChangedAt > audit.diagnosisAt,
  );
  const canEdit = !readOnly;
  const t = await getTranslations("audit");

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("diagnosis.title")}</CardTitle>
          <CardDescription>
            {t("diagnosis.description", {
              min: AUDIT_LIMITS.minProblems,
              max: AUDIT_LIMITS.maxProblems,
            })}
          </CardDescription>
        </CardHeader>
        <p className="text-body-sm">
          {t("diagnosis.counts", { observations: observations.length, problems: usable.length })}
        </p>
        {outdated ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            {t("diagnosis.outdated")}
          </p>
        ) : null}
        {outcome && outcome.withoutEvidence > 0 ? (
          <p role="status" className="rounded-md border border-warning-fill p-3 text-body-sm">
            {t("diagnosis.withoutEvidence", {
              count: outcome.withoutEvidence,
              proposed: outcome.proposed,
            })}
          </p>
        ) : null}
        {canEdit && aiAllowed ? (
          observations.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestDiagnosisAction.bind(null, audit.id)}
                icon={audit.diagnosisAt ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
                variant="primary"
                confirm={audit.diagnosisAt ? t("diagnosis.replaceConfirm") : undefined}
              >
                {audit.diagnosisAt ? t("diagnosis.update") : t("diagnosis.generate")}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">{t("diagnosis.needObservation")}</p>
          )
        ) : null}
        {!aiAllowed ? <p className="text-body-sm text-fg-muted">{t("diagnosis.noAi")}</p> : null}
      </Card>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-heading-md text-fg">{t("diagnosis.problems")}</h2>
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
              <FindingCard finding={toView(p, rt)} sources={links} readOnly={readOnly} />
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-body-sm text-fg-muted">
                  {p.parentIds.length
                    ? t("diagnosis.linkedTo", {
                        titles: p.parentIds
                          .map((id) => titles.get(id) ?? t("diagnosis.observationGone"))
                          .join(" · "),
                      })
                    : t("diagnosis.noLinked")}
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
                        {t("diagnosis.up")}
                      </ActionButton>
                    ) : null}
                    {i < problems.length - 1 ? (
                      <ActionButton
                        action={moveProblemAction.bind(null, p.id, "down")}
                        icon={<ArrowDown aria-hidden />}
                        variant="ghost"
                        size="sm"
                      >
                        {t("diagnosis.down")}
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
              ? t("diagnosis.noUsable")
              : outcome
                ? t("diagnosis.noneProposed")
                : t("diagnosis.empty")}
          </p>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("diagnosis.plan.title")}</CardTitle>
          <CardDescription>{t("diagnosis.plan.description")}</CardDescription>
        </CardHeader>
        {canEdit && aiAllowed ? (
          usable.length ? (
            <div className="flex flex-wrap gap-3">
              <ActionButton
                action={requestPlanAction.bind(null, audit.id)}
                icon={plan ? <RefreshCw aria-hidden /> : <Sparkles aria-hidden />}
                variant={plan ? "secondary" : "primary"}
                confirm={plan ? t("diagnosis.plan.replaceConfirm") : undefined}
              >
                {plan ? t("diagnosis.plan.regenerate") : t("diagnosis.plan.generate")}
              </ActionButton>
            </div>
          ) : (
            <p className="text-body-sm text-fg-muted">{t("diagnosis.plan.needProblem")}</p>
          )
        ) : null}
        {plan ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={findingStatusVariant[plan.status]}>
                {t(`findingStatus.${plan.status}`)}
              </Badge>
              {plan.authorAgent ? (
                <span className="text-body-sm text-fg-muted">
                  {t("diagnosis.plan.proposedByStrategist")}
                </span>
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
                  <caption className="sr-only">{t("diagnosis.plan.caption")}</caption>
                  <thead className="border-b border-subtle text-label text-fg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("diagnosis.plan.columns.day")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("diagnosis.plan.columns.channel")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("diagnosis.plan.columns.format")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("diagnosis.plan.columns.pillar")}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        {t("diagnosis.plan.columns.topic")}
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
                          <td className="px-3 py-2">{t(`channel.${it.channel}`)}</td>
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
                  {t("diagnosis.plan.accept")}
                </ActionButton>
                {plan.status !== "rejected" ? (
                  <ActionButton
                    action={reviewPlanAction.bind(null, audit.id, "reject")}
                    icon={<X aria-hidden />}
                    variant="ghost"
                  >
                    {t("diagnosis.plan.reject")}
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
