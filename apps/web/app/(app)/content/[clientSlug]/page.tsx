import {
  agentLabels,
  frequencyLabel,
  funnelLabels,
  getStrategyOverview,
  listUsableTemplates,
  pillarRowToInput,
  proposeStrategyJob,
  provenanceSchema,
  rubricRowToInput,
  type StrategyOverview,
} from "@forgecy/content";
import { can } from "@forgecy/core";
import { and, desc, eq, jobs } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { Archive, ArchiveRestore, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { archiveItemAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { RefreshWhile } from "../_components/refresh-while";
import { PillarForm, RubricForm, type StrategyOptions } from "../_components/strategy-forms";
import { AskPlannerForm } from "../_components/strategy-planner";
import { StrategyProposalCard } from "../_components/strategy-proposal";
import { formatDate } from "../_lib/paths";
import { loadClient } from "../_lib/server";

export const metadata = { title: "Content strategy" };

type Pillar = StrategyOverview["pillars"][number];
type Rubric = StrategyOverview["rubrics"][number];

const confidenceLabel = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};
const activeJob = new Set(["queued", "running", "retrying"]);
const freq = (count: number | null, unit: "week" | "month" | null) =>
  count && unit ? { count, unit } : null;
/** A live item (accepted, or accepted and then flagged “Needs review”). */
const isLive = (x: { status: string; decidedAt: Date | null; provenance: unknown }) =>
  x.status === "accepted" || (x.status === "stale" && (x.decidedAt !== null || !x.provenance));

function Facts({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== "" && v !== undefined);
  if (!shown.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt className="text-label text-fg-muted">{k}</dt>
          <dd className="text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const { db, user, client } = await loadClient(clientSlug);
  const actor = user.actor;
  const o = await getStrategyOverview(db, actor, client.id);
  const [templates, [lastJob]] = await Promise.all([
    listUsableTemplates(db, client.id),
    db
      .select({ status: jobs.status, error: jobs.error, createdAt: jobs.createdAt })
      .from(jobs)
      .where(and(eq(jobs.clientId, client.id), eq(jobs.kind, proposeStrategyJob.kind)))
      .orderBy(desc(jobs.createdAt))
      .limit(1),
  ]);
  const running = Boolean(lastJob && activeJob.has(lastJob.status));
  const failed = lastJob && (lastJob.status === "failed" || lastJob.status === "needs_attention");
  const canEdit = can(actor, "edit_draft", client.id);
  const canArchive = can(actor, "archive", client.id);
  const base = { slug: client.slug, clientId: client.id };

  const pillarName = new Map(o.pillars.map((p) => [p.id, p.name]));
  const productName = new Map(o.products.map((p) => [p.id, p.name]));
  const audienceName = new Map((o.brand?.audience ?? []).map((a) => [a.id, a.name]));
  const templateName = new Map(templates.map((t) => [t.key, t.name]));
  const livePillars = o.pillars.filter(isLive);
  const liveRubrics = o.rubrics.filter(isLive);
  const proposedPillars = o.pillars.filter((p) => p.status === "proposed");
  const proposedRubrics = o.rubrics.filter((r) => r.status === "proposed");
  const archived = [
    ...o.pillars
      .filter((p) => p.status === "archived" && !p.targetId)
      .map((p) => ({
        kind: "pillar" as const,
        id: p.id,
        name: p.name,
        at: p.archivedAt,
        note: "Pillar",
      })),
    ...o.rubrics
      .filter((r) => r.status === "archived" && !r.targetId)
      .map((r) => ({
        kind: "rubric" as const,
        id: r.id,
        name: r.name,
        at: r.archivedAt,
        note: `Rubric of “${pillarName.get(r.pillarId) ?? "—"}”`,
      })),
  ];
  const options: StrategyOptions = {
    audience: o.brand?.audience ?? [],
    products: o.hasCatalog ? o.products.map((p) => ({ id: p.id, name: p.name })) : [],
    templates: templates.map((t) => ({ key: t.key, name: t.name })),
    pillars: livePillars.map((p) => ({ id: p.id, name: p.name })),
  };
  const names = (ids: readonly string[], map: Map<string, string>) =>
    ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .join(", ") || null;

  const pillarFacts = (p: Pillar): [string, ReactNode][] => [
    ["Goal", p.goal],
    ["Funnel", p.funnel ? funnelLabels[p.funnel] : null],
    ["Frequency", frequencyLabel(freq(p.frequencyCount, p.frequencyUnit))],
    ["Audience", names(p.audienceIds, audienceName)],
    ["Themes", p.themes.join(", ") || null],
    ["Call to action", p.cta],
    ["Products", o.hasCatalog ? names(p.productIds, productName) : null],
  ];
  const rubricFacts = (r: Rubric): [string, ReactNode][] => [
    ["Frequency", frequencyLabel(freq(r.frequencyCount, r.frequencyUnit))],
    [
      "Channels",
      r.channels.map((c) => (c === "linkedin" ? "LinkedIn" : "Instagram")).join(", ") || null,
    ],
    ["Template", r.templateKey ? (templateName.get(r.templateKey) ?? r.templateKey) : null],
    ["Hook formula", r.hookFormula],
    ["Call to action", r.cta],
    ["Products", o.hasCatalog ? names(r.productIds, productName) : null],
  ];

  const proposalCard = (
    kind: "pillar" | "rubric",
    row: Pillar | Rubric,
    facts: [string, ReactNode][],
  ) => {
    const prov = provenanceSchema.safeParse(row.provenance);
    const p = prov.success ? prov.data : null;
    const target = row.targetId
      ? kind === "pillar"
        ? pillarName.get(row.targetId)
        : liveRubrics.find((r) => r.id === row.targetId)?.name
      : null;
    const prefix =
      kind === "pillar"
        ? "Pillar"
        : `Rubric of “${pillarName.get((row as Rubric).pillarId) ?? "—"}”`;
    return (
      <StrategyProposalCard
        key={row.id}
        {...base}
        kind={kind}
        id={row.id}
        title={`${prefix}: ${row.name}`}
        agent={p ? agentLabels[p.agent] : "Planner"}
        sources={p?.sources.map((s) => ({ label: s.label })) ?? []}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {target ? (
              <Badge variant="info">Edit “{target}”</Badge>
            ) : (
              <Badge variant="info">New</Badge>
            )}
            {p ? <Badge>{confidenceLabel[p.confidence]}</Badge> : null}
          </div>
          <Facts items={facts} />
          {p?.rationale ? <p className="text-body-sm text-fg">{p.rationale}</p> : null}
          {p?.instruction ? (
            <p className="text-body-sm text-fg-muted">Instruction: “{p.instruction}”</p>
          ) : null}
        </div>
      </StrategyProposalCard>
    );
  };

  const archiveButton = (kind: "pillar" | "rubric", id: string, name: string) =>
    canArchive ? (
      <ActionButton
        size="sm"
        variant="ghost"
        action={archiveItemAction.bind(null, { ...base, kind, id })}
        confirm={
          kind === "pillar"
            ? `Archive “${name}”? Its rubrics will be archived too.`
            : `Archive “${name}”?`
        }
      >
        <Archive aria-hidden />
        Archive
      </ActionButton>
    ) : null;

  return (
    <div className="space-y-8">
      <RefreshWhile active={running} />

      <Card className="space-y-3 p-5">
        <h2 className="text-heading-sm text-fg">Ask the Planner</h2>
        <p className="text-body-sm text-fg-muted">
          The Planner proposes pillars and rubrics based on the Brand Identity. Proposals stay
          pending until a person accepts them.
        </p>
        {running ? (
          <p role="status" className="flex items-center gap-2 text-body-sm text-fg">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            The Planner is preparing a proposal…
          </p>
        ) : failed ? (
          <p role="alert" className="text-body-sm text-error">
            The last request to the Planner failed
            {lastJob.error ? `: ${lastJob.error}` : "."}
          </p>
        ) : null}
        {canEdit ? (
          <AskPlannerForm
            {...base}
            running={running}
            disabledReason={o.brand ? null : "A published Brand Identity is required."}
          />
        ) : null}
      </Card>

      {o.warnings.length ? (
        <section aria-labelledby="freq-warn" className="space-y-2">
          <h2 id="freq-warn" className="sr-only">
            Frequency warnings
          </h2>
          {o.warnings.map((w) => (
            <p
              key={w.pillarId}
              role="status"
              className="flex items-start gap-2 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
            >
              <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0 text-warning" />
              {w.message}
            </p>
          ))}
        </section>
      ) : null}

      {proposedPillars.length || proposedRubrics.length ? (
        <section aria-labelledby="proposals" className="space-y-4">
          <h2 id="proposals" className="text-heading-md text-fg">
            Planner proposals ({proposedPillars.length + proposedRubrics.length})
          </h2>
          <p className="text-body-sm text-fg-muted">
            Accept pillars first: a rubric can be accepted only if its pillar is active.
          </p>
          {proposedPillars.map((p) => proposalCard("pillar", p, pillarFacts(p)))}
          {proposedRubrics.map((r) => proposalCard("rubric", r, rubricFacts(r)))}
        </section>
      ) : null}

      <section aria-labelledby="pillars" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pillars" className="text-heading-md text-fg">
            Pillars ({livePillars.length})
          </h2>
          {canEdit ? <PillarForm {...base} options={options} label="New pillar" /> : null}
        </div>
        {!livePillars.length ? (
          <Card className="p-6">
            <p className="text-body-md text-fg-muted">
              No active pillars. Create one manually or ask the Planner for a proposal.
            </p>
          </Card>
        ) : null}
        {livePillars.map((p) => {
          const rubrics = liveRubrics.filter((r) => r.pillarId === p.id);
          return (
            <Card key={p.id} className="space-y-4 p-5">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-heading-sm text-fg">{p.name}</h3>
                  <div className="flex flex-wrap gap-2">
                    {p.status === "stale" ? <Badge variant="warning">Needs review</Badge> : null}
                    <Badge>{p.contents === 1 ? "1 carousel" : `${p.contents} carousels`}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {canEdit ? (
                    <PillarForm
                      {...base}
                      id={p.id}
                      rev={p.rev}
                      initial={pillarRowToInput(p)}
                      options={options}
                      label="Edit"
                    />
                  ) : null}
                  {archiveButton("pillar", p.id, p.name)}
                </div>
              </header>
              <Facts items={pillarFacts(p)} />
              <div className="space-y-3 border-t border-subtle pt-4">
                <h4 className="text-label uppercase text-fg-muted">Rubrics ({rubrics.length})</h4>
                {rubrics.length ? (
                  <ul className="space-y-3">
                    {rubrics.map((r) => (
                      <li key={r.id} className="space-y-3 rounded-md border border-subtle p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <p className="flex flex-wrap items-center gap-2 text-body-md font-medium text-fg">
                            {r.name}
                            {r.status === "stale" ? (
                              <Badge variant="warning">Needs review</Badge>
                            ) : null}
                          </p>
                          <div className="flex flex-wrap items-start gap-2">
                            {canEdit ? (
                              <RubricForm
                                {...base}
                                id={r.id}
                                rev={r.rev}
                                pillarId={p.id}
                                initial={rubricRowToInput(r)}
                                options={options}
                                label="Edit"
                              />
                            ) : null}
                            {archiveButton("rubric", r.id, r.name)}
                          </div>
                        </div>
                        <Facts items={rubricFacts(r)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body-sm text-fg-muted">No rubrics for this pillar.</p>
                )}
                {canEdit ? (
                  <RubricForm {...base} pillarId={p.id} options={options} label="Add rubric" />
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>

      {archived.length ? (
        <details className="rounded-lg border border-subtle bg-surface p-5">
          <summary className="cursor-pointer text-heading-sm text-fg">
            Archived ({archived.length})
          </summary>
          <ul className="mt-4 space-y-2">
            {archived.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 text-body-sm"
              >
                <span className="text-fg">
                  {a.name}{" "}
                  <span className="text-fg-muted">
                    · {a.note} · archived {formatDate(a.at)}
                  </span>
                </span>
                {canArchive ? (
                  <ActionButton
                    size="sm"
                    variant="secondary"
                    action={archiveItemAction.bind(null, {
                      ...base,
                      kind: a.kind,
                      id: a.id,
                      restore: true,
                    })}
                  >
                    <ArchiveRestore aria-hidden />
                    Restore
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
