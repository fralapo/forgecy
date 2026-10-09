import {
  ACCEPTANCE_MIN_DECIDED,
  AGENT_CAPABILITIES,
  acceptanceRate,
  agentStatistics,
  aiTasks,
  estimatePreviewCostMicroUsd,
  getDefaultAiPolicy,
  PREVIEW_EXAMPLE_MAX,
  listAgentRuns,
  type AiTask,
} from "@forgecy/ai";
import { AGENT_INSTRUCTIONS_MAX, agentKeySchema } from "@forgecy/core";
import { getDb, inArray, users } from "@forgecy/db";
import { Badge, Button, Card, cn } from "@forgecy/ui";
import { ArrowLeft, Bot, Brain, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { loadAgentsView, modelLabel, NO_PROPOSALS } from "../_components/data";
import {
  ActivationForm,
  InstructionsForm,
  RoutesForm,
  type PreviewOptions,
} from "../_components/forms";

export const dynamic = "force-dynamic";

const tabs = ["overview", "tasks", "instructions", "runs", "stats"] as const;
type Tab = (typeof tabs)[number];
const ITEMS = ["1", "2", "3"] as const;
const RUNS_LIMIT = 50;

const runVariant = { ok: "success", error: "error", blocked: "warning" } as const;

export async function generateMetadata({ params }: { params: Promise<{ agentKey: string }> }) {
  const t = await getTranslations("agents");
  const key = agentKeySchema.safeParse((await params).agentKey);
  return { title: key.success ? t(`name.${key.data}`) : t("title") };
}

/** Agent details (spec page 55); the configuration commands are for Admins only. */
export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentKey: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const key = agentKeySchema.safeParse((await params).agentKey);
  if (!key.success) notFound();
  const agent = key.data;
  const sp = await searchParams;
  const tab: Tab = tabs.find((x) => x === sp.tab) ?? "overview";
  const t = await getTranslations("agents");
  const tp = await getTranslations("settings.providers");
  const format = await getFormat();
  const { configs, stats, taskModels, providers } = await loadAgentsView(tp("localModel"));
  const config = configs[agent];
  const stat = stats[agent];
  const name = t(`name.${agent}`);
  const admin = user.isAdmin;
  const money = (micro: number, digits = 2) =>
    format.number(micro / 1_000_000, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: digits,
    });
  const taskLabel = (task: string) =>
    (aiTasks as readonly string[]).includes(task) || task === "image"
      ? t(`task.${task as AiTask | "image"}`)
      : task;
  const list = (group: "inputs" | "outputs") => ITEMS.map((i) => t(`${group}.${agent}.${i}`));
  const version = (v: number) => t("list.version", { version: v });

  let main: ReactNode;
  if (tab === "overview") {
    main = (
      <div className="grid gap-6">
        <Card className="grid gap-4 p-6">
          <div>
            <h2 className="text-heading-sm text-fg">{t("detail.roleTitle")}</h2>
            <p className="mt-2 text-body-md text-fg">{t(`role.${agent}`)}</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {(["inputs", "outputs"] as const).map((g) => (
              <div key={g}>
                <h3 className="text-label text-fg-muted">
                  {t(g === "inputs" ? "detail.inputsTitle" : "detail.outputsTitle")}
                </h3>
                <ul className="mt-2 grid list-disc gap-1 pl-5 text-body-sm text-fg">
                  {list(g).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
        <Card className="grid gap-3 p-6">
          <h2 className="text-heading-sm text-fg">{t("activation.title")}</h2>
          <p className="text-body-sm text-fg">
            {t(config.active ? "activation.activeBody" : "activation.inactiveBody")}
          </p>
          {admin ? <ActivationForm agent={agent} name={name} active={config.active} /> : null}
        </Card>
      </div>
    );
  } else if (tab === "tasks") {
    const models = taskModels(agent);
    const editable = models.filter((m) => m.task !== "image");
    const route = (task: string) => config.routes[task as keyof typeof config.routes];
    main = (
      <Card className="grid gap-6 p-6">
        <p className="text-body-sm text-fg-muted">{t("tasks.intro")}</p>
        {models.length === 0 ? (
          <p className="text-body-md text-fg">{t("tasks.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  {(["task", "inUse", "fallback", "source"] as const).map((c) => (
                    <th key={c} scope="col" className="py-2 pr-4 font-medium">
                      {t(`tasks.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.task} className="border-b border-subtle last:border-0">
                    <td className="py-2 pr-4 text-fg">{taskLabel(m.task)}</td>
                    <td className="py-2 pr-4 font-mono text-fg">{modelLabel(m.primary) || "—"}</td>
                    <td className="py-2 pr-4 font-mono text-fg-muted">
                      {modelLabel(m.fallback) || t("tasks.noFallback")}
                    </td>
                    <td className="py-2 pr-4 text-fg-muted">
                      {t(m.fromAgent ? "tasks.sourceAgent" : "tasks.sourceSettings")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {admin ? (
          <>
            <Link href="/settings/ai-providers" className="w-fit text-body-sm text-link">
              {t("tasks.settingsLink")}
            </Link>
            {editable.length ? (
              <section className="grid gap-4 border-t border-subtle pt-6">
                <h3 className="text-heading-sm text-fg">{t("tasks.edit")}</h3>
                <RoutesForm
                  agent={agent}
                  providers={providers}
                  rows={editable.map((m) => ({
                    task: m.task,
                    label: taskLabel(m.task),
                    provider: route(m.task)?.provider ?? "default",
                    model: route(m.task)?.model ?? "",
                  }))}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </Card>
    );
  } else if (tab === "instructions") {
    const ids = [
      ...new Set(
        config.history.flatMap((v) => [v.createdBy, v.publishedBy]).filter((x) => x !== null),
      ),
    ];
    const people = new Map(
      (ids.length
        ? await getDb()
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, ids))
        : []
      ).map((u) => [u.id, u.name]),
    );
    const who = (id: string | null) => (id && people.get(id)) || t("instructions.unknownAuthor");
    const pub = config.published;
    const nextVersion = config.draft?.version ?? (config.history[0]?.version ?? 0) + 1;
    // “Try on an example”: the agent's language-model tasks, with the model and cost of a try.
    const previewOptions = async (): Promise<PreviewOptions> => {
      const { policy } = await getDefaultAiPolicy(getDb());
      const tasks = taskModels(agent).filter((m) => m.task !== "image");
      return {
        unavailable:
          policy === "no_ai" ? t("preview.noAi") : tasks.length === 0 ? t("preview.noTasks") : null,
        exampleMax: PREVIEW_EXAMPLE_MAX,
        tasks: tasks.map((m) => {
          const cost = estimatePreviewCostMicroUsd(m.primary);
          const model = modelLabel(m.primary);
          return {
            value: m.task,
            label: taskLabel(m.task),
            estimate:
              cost === null
                ? t("preview.estimateUnknown", { model })
                : t("preview.estimate", { model, cost: money(cost, 4) }),
          };
        }),
      };
    };
    main = (
      <div className="grid gap-6">
        <Card className="grid gap-3 p-6">
          <p className="text-body-sm text-fg-muted">{t("instructions.intro")}</p>
          <h2 className="text-heading-sm text-fg">{t("instructions.published")}</h2>
          {pub ? (
            <>
              <p className="text-body-sm text-fg-muted">
                {t("instructions.publishedOn", {
                  version: pub.version,
                  date: format.date(pub.publishedAt ?? pub.createdAt, "long"),
                  name: who(pub.publishedBy),
                })}
              </p>
              {pub.text.trim() ? (
                <pre
                  tabIndex={0}
                  aria-label={t("instructions.text")}
                  className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-subtle bg-app p-3 font-mono text-body-sm text-fg"
                >
                  {pub.text}
                </pre>
              ) : (
                <p className="text-body-sm text-fg">
                  {t("instructions.emptyPublished", { version: pub.version })}
                </p>
              )}
            </>
          ) : (
            <p className="text-body-sm text-fg">{t("instructions.nonePublished")}</p>
          )}
        </Card>
        {admin ? (
          <Card className="p-6">
            <InstructionsForm
              key={`${config.draft?.id ?? "new"}-${pub?.version ?? 0}`}
              agent={agent}
              version={nextVersion}
              initial={config.draft?.text ?? pub?.text ?? ""}
              hasDraft={!!config.draft}
              max={AGENT_INSTRUCTIONS_MAX}
              preview={await previewOptions()}
            />
          </Card>
        ) : null}
        {config.history.length ? (
          <section>
            <h2 className="mb-3 text-heading-sm text-fg">{t("instructions.historyTitle")}</h2>
            <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-subtle text-label text-fg-muted">
                  <tr>
                    {(["version", "statusColumn", "date", "author", "changelog"] as const).map(
                      (c) => (
                        <th key={c} scope="col" className="px-4 py-3 font-medium">
                          {t(`instructions.${c}`)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {config.history.map((v) => (
                    <tr key={v.id} className="border-b border-subtle align-top last:border-0">
                      <td className="px-4 py-3 font-mono text-fg">{version(v.version)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={v.status === "published" ? "success" : "neutral"}>
                          {t(`instructions.statusValue.${v.status}`)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-fg">
                        {format.date(v.publishedAt ?? v.createdAt, "dateTime")}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {who(v.publishedBy ?? v.createdBy)}
                      </td>
                      <td className="px-4 py-3 text-fg">{v.changelog ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    );
  } else if (tab === "stats") {
    const st = await agentStatistics(getDb(), agent);
    const o = st.proposals;
    const decided = o.accepted + o.rejected;
    const rate = acceptanceRate(o);
    const maxRuns = Math.max(1, ...st.weeks.map((w) => w.runs));
    const maxCost = Math.max(1, ...st.months.map((m) => m.costMicroUsd));
    const bar = (value: number, max: number) => (
      <div aria-hidden className="h-2 w-full min-w-24 overflow-hidden rounded-full bg-app">
        <div className="h-full bg-primary" style={{ width: `${(value / max) * 100}%` }} />
      </div>
    );
    const reasonLabel = (r: string) =>
      r === "error"
        ? t("stats.error")
        : t(
            `run.reason.${(["no_ai", "local_unavailable", "agent_disabled", "budget_exceeded"] as const).find((k) => k === r) ?? "other"}`,
          );
    const th = "px-4 py-2 font-medium";
    const td = "px-4 py-2";
    main = (
      <div className="grid gap-6">
        <Card className="grid gap-4 p-6">
          <h2 className="text-heading-sm text-fg">{t("stats.proposalsTitle")}</h2>
          {NO_PROPOSALS.includes(agent) ? (
            <p className="text-body-md text-fg-muted">{t("stats.notApplicable")}</p>
          ) : (
            <>
              <p className="text-heading-md text-fg">
                {rate === null
                  ? t("stats.notEnough", { min: ACCEPTANCE_MIN_DECIDED, decided })
                  : t("stats.rate", {
                      percent: format.number(rate, { style: "percent" }),
                      accepted: o.accepted,
                      decided,
                    })}
              </p>
              <dl className="grid grid-cols-3 gap-4 text-body-sm">
                {(["accepted", "rejected", "stale"] as const).map((k) => (
                  <div key={k} className="grid gap-1">
                    <dt className="text-fg-muted">{t(`stats.${k}`)}</dt>
                    <dd className="text-heading-sm text-fg">{format.number(o[k])}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-body-sm text-fg-muted">{t("stats.sources")}</p>
            </>
          )}
        </Card>
        <Card className="grid gap-3 p-6">
          <h2 className="text-heading-sm text-fg">{t("stats.weeksTitle")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="text-label text-fg-muted">
                <tr>
                  <th scope="col" className={th}>
                    {t("stats.week")}
                  </th>
                  <th scope="col" className={th}>
                    {t("stats.runs")}
                  </th>
                  <th scope="col" className={th}>
                    {t("stats.failed")}
                  </th>
                  <th scope="col" className={cn(th, "w-1/2")}>
                    <span className="sr-only">{t("stats.runs")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {st.weeks.map((w) => (
                  <tr key={w.week.toISOString()} className="border-t border-subtle">
                    <td className={cn(td, "whitespace-nowrap text-fg")}>
                      {format.date(w.week, "date")}
                    </td>
                    <td className={cn(td, "text-fg")}>{format.number(w.runs)}</td>
                    <td className={cn(td, w.failed ? "text-error" : "text-fg-muted")}>
                      {format.number(w.failed)}
                    </td>
                    <td className={td}>{bar(w.runs, maxRuns)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="grid content-start gap-3 p-6">
            <h2 className="text-heading-sm text-fg">{t("stats.failuresTitle")}</h2>
            {st.failures.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body-sm">
                  <thead className="text-label text-fg-muted">
                    <tr>
                      <th scope="col" className={th}>
                        {t("stats.reason")}
                      </th>
                      <th scope="col" className={th}>
                        {t("stats.count")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.failures.map((f) => (
                      <tr key={f.reason} className="border-t border-subtle">
                        <td className={cn(td, "text-fg")}>{reasonLabel(f.reason)}</td>
                        <td className={cn(td, "text-fg")}>{format.number(f.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-body-sm text-fg-muted">{t("stats.failuresNone")}</p>
            )}
          </Card>
          <Card className="grid content-start gap-3 p-6">
            <h2 className="text-heading-sm text-fg">{t("stats.costTitle")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="text-label text-fg-muted">
                  <tr>
                    <th scope="col" className={th}>
                      {t("stats.month")}
                    </th>
                    <th scope="col" className={th}>
                      {t("stats.cost")}
                    </th>
                    <th scope="col" className={cn(th, "w-1/3")}>
                      <span className="sr-only">{t("stats.cost")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {st.months.map((m) => (
                    <tr key={m.month.toISOString()} className="border-t border-subtle">
                      <td className={cn(td, "whitespace-nowrap text-fg")}>
                        {format.date(m.month, "month")}
                      </td>
                      <td className={cn(td, "text-fg")}>{money(m.costMicroUsd)}</td>
                      <td className={td}>{bar(m.costMicroUsd, maxCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        {st.slideEdits ? (
          <Card className="grid gap-3 p-6">
            <h2 className="text-heading-sm text-fg">{t("stats.editsTitle")}</h2>
            {st.slideEdits.kept + st.slideEdits.reverted ? (
              <dl className="grid grid-cols-2 gap-4 text-body-sm">
                {(["kept", "reverted"] as const).map((k) => (
                  <div key={k} className="grid gap-1">
                    <dt className="text-fg-muted">{t(`stats.${k}`)}</dt>
                    <dd className="text-heading-sm text-fg">{format.number(st.slideEdits![k])}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-body-sm text-fg-muted">{t("stats.editsNone")}</p>
            )}
          </Card>
        ) : null}
      </div>
    );
  } else {
    const runs = await listAgentRuns(getDb(), user.actor, agent, RUNS_LIMIT);
    main =
      runs.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("runs.empty")}</p>
        </Card>
      ) : (
        <>
          <p className="mb-3 text-body-sm text-fg-muted">
            {t("runs.limitNote", { count: RUNS_LIMIT })}
          </p>
          <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  {(
                    [
                      "date",
                      "task",
                      "client",
                      "startedBy",
                      "statusColumn",
                      "model",
                      "instructions",
                      "cost",
                    ] as const
                  ).map((c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-medium">
                      {t(`runs.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-subtle align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={`/agents/runs/${r.id}` as Route} className="text-link">
                        {format.date(r.startedAt, "dateTime")}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg">{taskLabel(r.kind)}</td>
                    <td className="px-4 py-3 text-fg">{r.clientName ?? t("runs.noClient")}</td>
                    <td className="px-4 py-3 text-fg-muted">{r.startedBy ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={runVariant[r.status]}>
                        {t(`runs.statusValue.${r.status}`)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-fg">
                      {r.provider && r.model ? `${r.provider} · ${r.model}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-fg">
                      {r.instructionsVersion
                        ? version(r.instructionsVersion)
                        : t("list.noInstructions")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-fg">
                      {money(r.costMicroUsd, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
  }

  const wide = tab === "runs" || tab === "stats";
  return (
    <>
      <Link href="/agents" className="mb-4 inline-flex items-center gap-1 text-body-sm text-link">
        <ArrowLeft aria-hidden className="size-4" />
        {t("detail.back")}
      </Link>
      <PageHeader
        title={name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-body-sm text-fg-muted">
              <Bot aria-hidden className="size-4" />
              {agent}
            </span>
            <Badge variant={config.active ? "success" : "neutral"}>
              {t(config.active ? "status.active" : "status.inactive")}
            </Badge>
            {config.published?.text.trim() ? (
              <span className="font-mono text-body-sm text-fg-muted">
                {version(config.published.version)}
              </span>
            ) : null}
            <Button asChild variant="secondary">
              <Link href={`/agents/${agent}/memory` as Route}>
                <Brain aria-hidden />
                {t("memory.open")}
              </Link>
            </Button>
          </div>
        }
      />
      <nav aria-label={t("detail.tabsLabel")} className="mb-6 border-b border-subtle">
        <ul className="flex flex-wrap gap-1">
          {tabs.map((k) => (
            <li key={k}>
              <Link
                href={`/agents/${agent}?tab=${k}` as Route}
                aria-current={tab === k ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-11 items-center border-b-2 px-3 text-body-sm",
                  tab === k
                    ? "border-primary text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t(`detail.tabs.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Runs and statistics need the full width: there the side cards go below. */}
      <div className={cn("grid gap-6", !wide && "xl:grid-cols-[2fr_1fr]")}>
        <div className="min-w-0">{main}</div>
        <aside className={cn("grid content-start gap-6", wide && "lg:grid-cols-3")}>
          <Card className="grid gap-3 p-6">
            <h2 className="text-heading-sm text-fg">{t("detail.permissionsTitle")}</h2>
            <ul className="grid gap-2">
              {AGENT_CAPABILITIES[agent].map((cap) => (
                <li key={cap} className="grid gap-0.5 text-body-sm">
                  <span className="w-fit rounded-sm border border-subtle px-2 py-0.5 font-mono text-fg">
                    {t(`capability.${cap}`)}
                  </span>
                  <span className="text-fg-muted">{t(`capabilityHint.${cap}`)}</span>
                </li>
              ))}
            </ul>
            <p className="flex items-start gap-2 text-body-sm text-fg">
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
              {t("detail.never")}
            </p>
          </Card>
          <Card className="grid gap-3 p-6">
            <h2 className="text-heading-sm text-fg">{t("detail.limitsTitle")}</h2>
            <ul className="grid list-disc gap-1 pl-5 text-body-sm text-fg">
              {ITEMS.map((i) => (
                <li key={i}>{t(`detail.limits.${i}`)}</li>
              ))}
            </ul>
          </Card>
          <Card className="p-6">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body-sm">
              <dt className="text-fg-muted">{t("detail.statsRuns")}</dt>
              <dd className="text-right text-fg">{format.number(stat.runs)}</dd>
              <dt className="text-fg-muted">{t("detail.statsFailed")}</dt>
              <dd className="text-right text-fg">{format.number(stat.failed)}</dd>
              <dt className="text-fg-muted">{t("detail.statsCost")}</dt>
              <dd className="text-right text-fg">{money(stat.monthCostMicroUsd)}</dd>
            </dl>
          </Card>
        </aside>
      </div>
    </>
  );
}
