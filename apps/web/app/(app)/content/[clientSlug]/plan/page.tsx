import { FORMATS } from "@forgecy/carousel";
import {
  agentLabels,
  channelLabels,
  getNewCarouselOptions,
  getStrategyOverview,
  planItemRowToInput,
  proposePlanJob,
  provenanceSchema,
  releasedFormats,
  strategyStatusLabels,
  type CarouselParamsInput,
  type ContentChannel,
  type StrategyOverview,
} from "@forgecy/content";
import { can, type ContentObjective, type FunnelStage } from "@forgecy/core";
import { and, desc, eq, jobs } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { Check, ExternalLink, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { decidePlanItemAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";
import {
  AskPlanForm,
  CreateCarouselButton,
  PlanItemForm,
  PlanProposal,
  type PlanOptions,
} from "../../_components/plan-forms";
import { RefreshWhile } from "../../_components/refresh-while";
import { carouselPath } from "../../_lib/paths";
import { loadClient } from "../../_lib/server";

export const metadata = { title: "Content plan" };

type Plan = NonNullable<StrategyOverview["activePlan"]>;
type Item = Plan["items"][number];

const activeJob = new Set(["queued", "running", "retrying"]);
const objectiveOfFunnel: Record<FunnelStage, ContentObjective> = {
  awareness: "awareness",
  consideration: "education",
  conversion: "conversion",
  loyalty: "community",
};
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dateOf = (plan: Plan, day: number) => {
  const d = new Date(plan.acceptedAt ?? plan.createdAt);
  d.setDate(d.getDate() + day - 1);
  return dayFormat.format(d);
};
const statusVariant = { accepted: "success", proposed: "info", stale: "warning" } as const;

export default async function PlanPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params;
  const { db, user, client } = await loadClient(clientSlug);
  const actor = user.actor;
  const [o, newOptions, [lastJob]] = await Promise.all([
    getStrategyOverview(db, actor, client.id),
    getNewCarouselOptions(db, actor, client.id),
    db
      .select({ status: jobs.status, error: jobs.error })
      .from(jobs)
      .where(and(eq(jobs.clientId, client.id), eq(jobs.kind, proposePlanJob.kind)))
      .orderBy(desc(jobs.createdAt))
      .limit(1),
  ]);
  const running = Boolean(lastJob && activeJob.has(lastJob.status));
  const failed = lastJob && (lastJob.status === "failed" || lastJob.status === "needs_attention");
  const canEdit = can(actor, "edit_draft", client.id);
  const base = { slug: client.slug, clientId: client.id };

  const pillarById = new Map(o.pillars.map((p) => [p.id, p]));
  const rubricById = new Map(o.rubrics.map((r) => [r.id, r]));
  const productName = new Map(o.products.map((p) => [p.id, p.name]));
  const options: PlanOptions = {
    pillars: o.pillars
      .filter((p) => p.status === "accepted")
      .map((p) => ({ id: p.id, name: p.name })),
    rubrics: o.rubrics
      .filter((r) => r.status === "accepted")
      .map((r) => ({ id: r.id, name: r.name, pillarId: r.pillarId })),
    formats: releasedFormats.map((id) => ({
      id,
      label: FORMATS[id].label,
      channel: FORMATS[id].channel as ContentChannel,
    })),
    products: o.hasCatalog ? o.products.map((p) => ({ id: p.id, name: p.name })) : [],
  };
  const audienceIds = new Set(newOptions.audience.map((a) => a.id));

  /** Carousel parameters seeded from the item; the server copies title, pillar, rubric and brief. */
  const carouselSeed = (
    item: Item,
  ): { params: CarouselParamsInput | null; reason: string | null } => {
    const pillar = item.pillarId ? pillarById.get(item.pillarId) : undefined;
    const rubric = item.rubricId ? rubricById.get(item.rubricId) : undefined;
    const forFormat = newOptions.templates.filter((t) => t.format === item.format);
    const template = forFormat.find((t) => t.key === rubric?.templateKey) ?? forFormat[0];
    if (!newOptions.brandPublished)
      return { params: null, reason: "A published Brand Identity is required." };
    if (!template) return { params: null, reason: "No published template for this format." };
    const own = (pillar?.audienceIds ?? []).filter((a) => audienceIds.has(a));
    const audience = own.length ? own : newOptions.audience.slice(0, 1).map((a) => a.id);
    if (!audience.length)
      return { params: null, reason: "The Brand Identity has no defined audience." };
    return {
      params: {
        objective: pillar?.funnel ? objectiveOfFunnel[pillar.funnel] : "awareness",
        audienceIds: audience,
        channel: item.channel as ContentChannel,
        format: item.format as CarouselParamsInput["format"],
        templateKey: template.key,
        slideCount: template.slides.default,
        planItemId: item.id,
      },
      reason: null,
    };
  };

  const describe = (item: Item) => {
    const pillar = item.pillarId ? pillarById.get(item.pillarId)?.name : null;
    const rubric = item.rubricId ? rubricById.get(item.rubricId)?.name : null;
    const products = o.hasCatalog
      ? item.productIds
          .map((id) => productName.get(id))
          .filter(Boolean)
          .join(", ")
      : "";
    return (
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-body-md font-medium text-fg">{item.theme}</p>
        {item.hook ? <p className="text-body-sm text-fg">Angle: {item.hook}</p> : null}
        <p className="text-body-sm text-fg-muted">
          {channelLabels[item.channel as ContentChannel] ?? item.channel} ·{" "}
          {FORMATS[item.format as keyof typeof FORMATS]?.label ?? item.format} ·{" "}
          {pillar ?? "Pillar removed"}
          {rubric ? ` › ${rubric}` : ""}
          {products ? ` · ${products}` : ""}
        </p>
        {item.notes ? <p className="text-body-sm text-fg-muted">{item.notes}</p> : null}
      </div>
    );
  };

  const itemRow = (plan: Plan, item: Item, actions: ReactNode) => (
    <li
      key={item.id}
      className="flex flex-wrap items-start gap-4 border-b border-subtle py-4 last:border-b-0"
    >
      <div className="w-24 shrink-0">
        <p className="text-label uppercase text-fg-muted">Day {item.day}</p>
        <p className="text-body-sm text-fg">{dateOf(plan, item.day)}</p>
      </div>
      {describe(item)}
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant={statusVariant[item.status as keyof typeof statusVariant] ?? "neutral"}>
          {strategyStatusLabels[item.status]}
        </Badge>
        {actions}
      </div>
    </li>
  );

  const editButton = (item: Item) =>
    canEdit ? (
      <PlanItemForm
        {...base}
        id={item.id}
        rev={item.rev}
        initial={planItemRowToInput(item)}
        options={options}
        label="Edit"
      />
    ) : null;

  const active = o.activePlan;
  const proposed = o.proposedPlan;
  const prov = proposed ? provenanceSchema.safeParse(proposed.provenance) : null;
  const p = prov?.success ? prov.data : null;

  return (
    <div className="space-y-8">
      <RefreshWhile active={running} />

      <Card className="space-y-3 p-5">
        <h2 className="text-heading-sm text-fg">Propose plan</h2>
        <p className="text-body-sm text-fg-muted">
          The Planner proposes a 30-day plan based on the active pillars and rubrics. The current
          plan doesn’t change until you activate the proposal.
        </p>
        {running ? (
          <p role="status" className="flex items-center gap-2 text-body-sm text-fg">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            The Planner is preparing the plan…
          </p>
        ) : failed ? (
          <p role="alert" className="text-body-sm text-error">
            The last plan request failed
            {lastJob.error ? `: ${lastJob.error}` : "."}
          </p>
        ) : null}
        {canEdit ? (
          <AskPlanForm
            {...base}
            running={running}
            disabledReason={
              !o.brand
                ? "A published Brand Identity is required."
                : !options.pillars.length
                  ? "At least one active pillar is required in Strategy."
                  : null
            }
          />
        ) : null}
      </Card>

      {proposed ? (
        <section aria-labelledby="proposed-plan" className="space-y-3">
          <h2 id="proposed-plan" className="text-heading-md text-fg">
            Proposed plan
          </h2>
          {canEdit ? (
            <PlanProposal
              {...base}
              planId={proposed.id}
              title={`Plan no. ${proposed.number} · ${proposed.items.length} items`}
              agent={p ? agentLabels[p.agent] : "Planner"}
              sources={p?.sources.map((s) => ({ label: s.label })) ?? []}
            >
              {p?.rationale ? <p className="text-body-sm text-fg">{p.rationale}</p> : null}
              {p?.instruction ? (
                <p className="text-body-sm text-fg-muted">Instruction: “{p.instruction}”</p>
              ) : null}
              <ul>
                {proposed.items.map((item) =>
                  itemRow(
                    proposed,
                    item,
                    item.status === "proposed" ? (
                      <>
                        <ActionButton
                          size="sm"
                          action={decidePlanItemAction.bind(null, {
                            ...base,
                            id: item.id,
                            decision: "accept",
                          })}
                        >
                          <Check aria-hidden />
                          Accept
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="secondary"
                          action={decidePlanItemAction.bind(null, {
                            ...base,
                            id: item.id,
                            decision: "reject",
                          })}
                        >
                          <X aria-hidden />
                          Reject
                        </ActionButton>
                        {editButton(item)}
                      </>
                    ) : null,
                  ),
                )}
              </ul>
            </PlanProposal>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="active-plan" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="active-plan" className="text-heading-md text-fg">
            {active ? `Current plan · no. ${active.number}` : "Current plan"}
          </h2>
          {canEdit ? <PlanItemForm {...base} options={options} label="Add item" /> : null}
        </div>
        {!active || !active.items.length ? (
          <Card className="p-6">
            <p className="text-body-md text-fg-muted">
              No items in the plan. Add one manually or ask the Planner for a proposal.
            </p>
          </Card>
        ) : (
          <Card className="px-5">
            <ul>
              {active.items.map((item) =>
                itemRow(
                  active,
                  item,
                  <>
                    {editButton(item)}
                    {item.status === "accepted" ? (
                      item.contentId ? (
                        <Link
                          href={carouselPath(client.slug, item.contentId) as Route}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-control bg-surface px-3 text-body-sm text-fg"
                        >
                          <ExternalLink aria-hidden className="size-4" />
                          Open carousel
                        </Link>
                      ) : canEdit ? (
                        (() => {
                          const seed = carouselSeed(item);
                          return (
                            <CreateCarouselButton
                              {...base}
                              params={seed.params}
                              disabledReason={seed.reason}
                            />
                          );
                        })()
                      ) : null
                    ) : null}
                  </>,
                ),
              )}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
