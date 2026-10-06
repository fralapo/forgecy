import {
  budgetsLeft,
  costPerItem,
  estimateRun,
  getAutomation,
  itemIssues,
  listRunItems,
  listRuns,
  planItemsFor,
  policyBlocker,
} from "@forgecy/automations";
import { getNewCarouselOptions } from "@forgecy/content";
import { ForgecyError, type MessageRef } from "@forgecy/core";
import { clients, contents, eq, getDb, inArray, users } from "@forgecy/db";
import { Badge, Card, cn } from "@forgecy/ui";
import { Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentRouting } from "@/lib/ai";
import { getFormat, getRefText } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { RefreshWhile } from "../../content/_components/refresh-while";
import { carouselPath, carouselsPath, planPath } from "../../content/_lib/paths";
import { AutomationEditor } from "../_components/automation-editor";
import { RunControls } from "../_components/run-controls";
import { AutomationStatusBadge, usd } from "../_components/status";

export async function generateMetadata() {
  const t = await getTranslations("automations");
  return { title: t("title") };
}

const uuidRe = /^[0-9a-f-]{36}$/i;

export default async function AutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ automationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ automationId }, sp] = await Promise.all([params, searchParams]);
  if (!uuidRe.test(automationId)) notFound();
  const user = await requireUser();
  const db = getDb();
  const a = await getAutomation(db, user.actor, automationId).catch((err: unknown) => {
    if (err instanceof ForgecyError && err.code === "not_found") notFound();
    throw err;
  });
  const t = await getTranslations("automations");
  const tp = await getTranslations("enums.aiPolicy");
  const format = await getFormat();
  const refText = await getRefText();
  const money = (micro: number) => format.currency(usd(micro), "USD");

  const [client] = await db.select().from(clients).where(eq(clients.id, a.clientId));
  if (!client) notFound();
  const runs = await listRuns(db, user.actor, a.id);
  const tab = sp.tab === "runs" ? "runs" : "config";
  const lastRun = runs[0] ?? null;
  const lastCounts = lastRun?.counts ?? null;
  const base = `/automations/${a.id}`;

  const [options, plan, cost, budgets, routing] = await Promise.all([
    getNewCarouselOptions(db, user.actor, a.clientId),
    a.source === "plan" ? planItemsFor(db, user.actor, a.clientId) : Promise.resolve([]),
    costPerItem(db),
    budgetsLeft(db, a.clientId),
    currentRouting(),
  ]);
  const blocker = policyBlocker(client.aiPolicy, Boolean(routing.routing.local));
  // Resuming continues the queued items; retrying reruns the failed ones.
  const pendingCount =
    a.status === "paused" ? (lastCounts?.queued ?? 0) : (lastCounts?.failed ?? 0);
  const followUp = pendingCount
    ? await estimateRun(db, { clientId: a.clientId, items: pendingCount, stopAt: a.stopAt })
    : null;

  const incomplete = a.items.filter((i) => itemIssues(i).length > 0).length;
  const done = lastCounts ? lastCounts.completed + lastCounts.failed + lastCounts.cancelled : 0;
  const next =
    a.status === "active"
      ? t("detail.next.running", { done, total: lastCounts?.total ?? 0 })
      : a.status === "paused"
        ? t("detail.next.paused")
        : a.status === "failed"
          ? t("detail.next.none")
          : lastCounts?.failed
            ? t("detail.next.retry", { count: lastCounts.failed })
            : lastCounts?.completed
              ? t("detail.next.review", { count: lastCounts.completed })
              : incomplete
                ? t("detail.next.incomplete", { count: incomplete })
                : a.items.length
                  ? t("detail.next.start")
                  : t("detail.next.none");

  const tabs = [
    { key: "config", href: base, label: t("detail.tabs.config") },
    { key: "runs", href: `${base}?tab=runs`, label: t("detail.tabs.runs") },
  ] as const;

  return (
    <>
      <RefreshWhile active={a.status === "active"} />
      <nav aria-label={t("detail.breadcrumb")} className="mb-2 text-body-sm">
        <Link href="/automations" className="text-link">
          {t("detail.breadcrumb")}
        </Link>
      </nav>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="font-display text-heading-lg text-fg">{a.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
            <AutomationStatusBadge status={a.status} />
            <span>{client.name}</span>
            <span aria-hidden>·</span>
            <span>{tp(client.aiPolicy)}</span>
            <span aria-hidden>·</span>
            <span>{t(`source.${a.source}`)}</span>
          </div>
          <p className="text-body-sm text-fg">{next}</p>
          {(a.status === "failed" || a.status === "paused") && a.statusReason ? (
            <p role="status" className="text-body-sm text-warning">
              {refText(a.statusReason as MessageRef, "")}
            </p>
          ) : null}
        </div>
        <RunControls
          id={a.id}
          name={a.name}
          status={a.status}
          canDelete={a.status === "draft" && runs.length === 0}
          failedCount={a.status === "draft" ? (lastCounts?.failed ?? 0) : 0}
          needsConfirm={Boolean(followUp?.needsConfirmation)}
        />
      </header>

      {a.status === "active" || a.status === "failed" ? (
        <p
          role="note"
          className="mb-6 flex items-start gap-2 rounded-md border border-subtle bg-surface p-4 text-body-sm text-fg"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          {t(a.status === "active" ? "detail.readOnly" : "detail.failedBanner")}
        </p>
      ) : null}

      <nav aria-label={t("detail.sectionsLabel")} className="mb-6 border-b border-subtle">
        <ul className="flex gap-1">
          {tabs.map((x) => (
            <li key={x.key}>
              <Link
                href={x.href as Route}
                aria-current={tab === x.key ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-body-sm",
                  tab === x.key
                    ? "border-primary text-fg"
                    : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {x.label}
                {x.key === "runs" && runs.length ? (
                  <span className="rounded-sm border border-control px-1 text-label text-fg">
                    {runs.length}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "config" ? (
        <AutomationEditor
          id={a.id}
          rev={a.draftRev}
          name={a.name}
          source={a.source}
          stopAt={a.stopAt}
          params={a.params}
          items={a.items}
          readOnly={a.status === "active" || a.status === "failed"}
          canStart={a.status === "draft"}
          options={{
            templates: options.templates.map((x) => ({
              key: x.key,
              name: x.name,
              format: x.format,
            })),
            pillars: options.pillars,
            rubrics: options.rubrics,
          }}
          plan={plan.map((p) => ({
            id: p.id,
            day: p.day,
            channel: p.channel,
            format: p.format,
            pillarId: p.pillarId,
            rubricId: p.rubricId,
            theme: p.theme,
            hook: p.hook ?? "",
            notes: p.notes ?? "",
            hasCarousel: Boolean(p.contentId),
          }))}
          planPath={planPath(client.slug)}
          summary={{
            policy: tp(client.aiPolicy),
            policyBlocker: blocker,
            costMicroUsd: cost,
            budgets: budgets.map((b) => ({
              scope: b.scope,
              limitMicroUsd: b.limitMicroUsd,
              leftMicroUsd: b.leftMicroUsd,
            })),
            clientName: client.name,
            hasAudience: options.audience.length > 0,
          }}
        />
      ) : (
        <RunsTab
          runs={runs}
          selectedId={typeof sp.run === "string" ? sp.run : (lastRun?.id ?? null)}
          base={base}
          clientSlug={client.slug}
          money={money}
        />
      )}
    </>
  );
}

async function RunsTab({
  runs,
  selectedId,
  base,
  clientSlug,
  money,
}: {
  runs: Awaited<ReturnType<typeof listRuns>>;
  selectedId: string | null;
  base: string;
  clientSlug: string;
  money: (micro: number) => string;
}) {
  const t = await getTranslations("automations");
  const tc = await getTranslations("content.labels.contentStatus");
  const format = await getFormat();
  const refText = await getRefText();
  const user = await requireUser();
  const db = getDb();
  if (!runs.length)
    return (
      <Card className="p-6">
        <p className="text-body-md text-fg-muted">{t("detail.runs.empty")}</p>
      </Card>
    );
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0]!;
  const items = await listRunItems(db, user.actor, selected.id);
  const contentIds = items.map((i) => i.contentId).filter((x): x is string => !!x);
  const starterIds = [...new Set(runs.map((r) => r.startedBy).filter((x): x is string => !!x))];
  const [carousels, starters] = await Promise.all([
    contentIds.length
      ? db
          .select({ id: contents.id, status: contents.status })
          .from(contents)
          .where(inArray(contents.id, contentIds))
      : Promise.resolve([]),
    starterIds.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, starterIds))
      : Promise.resolve([]),
  ]);
  const carouselOf = new Map(carousels.map((c) => [c.id, c]));
  const nameOf = new Map(starters.map((u) => [u.id, u.name]));

  return (
    <div className="grid gap-6">
      <p className="text-body-sm text-fg-muted">{t("detail.runs.approvalNote")}</p>
      <ul className="grid gap-2">
        {runs.map((r) => {
          const c = r.counts;
          const done = c ? c.completed + c.failed + c.cancelled : 0;
          const current = r.id === selected.id;
          return (
            <li key={r.id}>
              <Link
                href={`${base}?tab=runs&run=${r.id}` as Route}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-surface px-4 py-3 text-body-sm",
                  current ? "border-primary" : "border-subtle hover:border-control",
                )}
              >
                <span className="font-medium text-fg">
                  {t("detail.runs.run", { number: r.number })}
                </span>
                <span className="text-fg">
                  {t(`runStatus.${r.status}`, { done, total: c?.total ?? 0 })}
                </span>
                <span className="text-fg-muted">
                  {t("detail.runs.startedBy", {
                    name: (r.startedBy && nameOf.get(r.startedBy)) || t("list.unknownUser"),
                    date: format.date(r.startedAt, "dateTime"),
                  })}
                </span>
                <span className="text-fg-muted">
                  {t("list.costValue", {
                    actual: money(c?.costMicroUsd ?? 0),
                    estimate: money(r.estimateMicroUsd),
                  })}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="run-items" className="grid gap-3">
        <h2 id="run-items" className="text-heading-sm text-fg">
          {t("detail.runs.run", { number: selected.number })}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                {(["title", "status", "stepReached", "carousel", "cost", "error"] as const).map(
                  (c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-medium">
                      {t(`detail.runs.${c}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const carousel = i.contentId ? carouselOf.get(i.contentId) : undefined;
                return (
                  <tr key={i.id} className="border-b border-subtle align-top last:border-0">
                    <td className="px-4 py-3 text-fg">
                      {i.title || t("detail.items.item", { n: i.position + 1 })}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          i.status === "completed"
                            ? "success"
                            : i.status === "failed"
                              ? "error"
                              : i.status === "running"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {t(`detail.runs.itemStatus.${i.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-fg">{t(`detail.runs.step.${i.step}`)}</td>
                    <td className="px-4 py-3">
                      {carousel ? (
                        <>
                          <Link
                            href={carouselPath(clientSlug, carousel.id) as Route}
                            className="text-link"
                          >
                            {t("detail.runs.open")}
                          </Link>
                          <p className="text-fg-muted">{tc(carousel.status)}</p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg">{money(i.costMicroUsd)}</td>
                    <td className="px-4 py-3 text-fg">
                      {i.errorCode ? (
                        <>
                          <code className="text-label">{i.errorCode}</code>
                          <p className="text-fg-muted">
                            {refText(i.errorRef as MessageRef | null, i.error ?? "")}
                          </p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Link href={carouselsPath(clientSlug) as Route} className="text-body-sm text-link">
          {t("detail.actions.reviewDrafts")}
        </Link>
      </section>
    </div>
  );
}
