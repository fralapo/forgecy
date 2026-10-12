import { eligibleClients, listAutomations } from "@forgecy/automations";
import {
  automationSources,
  automationStatuses,
  type AutomationSource,
  type AutomationStatus,
} from "@forgecy/core";
import { clients, clientScopeWhere, getDb, inArray, users } from "@forgecy/db";
import { Button, Card } from "@forgecy/ui";
import { Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { controlClass } from "../content/_components/action-button";
import { NewAutomationForm } from "./_components/new-automation-form";
import { AutomationStatusBadge, usd } from "./_components/status";

export async function generateMetadata() {
  const t = await getTranslations("automations");
  return { title: t("title") };
}

const pick = <T extends string>(all: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const db = getDb();
  const t = await getTranslations("automations");
  const tp = await getTranslations("enums.aiPolicy");
  const format = await getFormat();
  const money = (micro: number) => format.currency(usd(micro), "USD");

  const status = pick<AutomationStatus>(automationStatuses, sp.status);
  const source = pick<AutomationSource>(automationSources, sp.source);
  const clientSlug = typeof sp.client === "string" ? sp.client : "";
  const [all, eligible, clientRows] = await Promise.all([
    listAutomations(db, user.actor),
    eligibleClients(db, user.actor),
    db
      .select({ id: clients.id, slug: clients.slug, aiPolicy: clients.aiPolicy })
      .from(clients)
      .where(clientScopeWhere(user.actor, clients.id)),
  ]);
  const clientBySlug = new Map(clientRows.map((c) => [c.slug, c]));
  const policyOf = new Map(clientRows.map((c) => [c.id, c.aiPolicy]));
  const rows = all
    .filter(
      (a) =>
        (!status || a.status === status) &&
        (!source || a.source === source) &&
        (!clientSlug || a.clientId === clientBySlug.get(clientSlug)?.id),
    )
    // Latest run first, then automations that never ran, newest first.
    .sort(
      (a, b) =>
        (b.lastRun?.startedAt.getTime() ?? 0) - (a.lastRun?.startedAt.getTime() ?? 0) ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  const creatorIds = [...new Set(all.map((a) => a.createdBy).filter((x): x is string => !!x))];
  const creators = new Map(
    (creatorIds.length
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, creatorIds))
      : []
    ).map((u) => [u.id, u.name]),
  );
  const filtered = Boolean(status || source || clientSlug);
  const clientsInList = [...new Map(all.map((a) => [a.clientSlug, a.clientName])).entries()];
  const active = all.filter((a) => a.status === "active").length;
  const paused = all.filter((a) => a.status === "paused").length;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={all.length ? t("counts", { active, paused }) : t("description")}
        actions={
          <NewAutomationForm
            clients={eligible.map((c) => ({ id: c.id, name: c.name }))}
            dateLabel={format.date(new Date())}
          />
        }
      />
      <p
        role="note"
        className="mb-6 flex items-start gap-2 rounded-md border border-subtle bg-surface p-4 text-body-sm text-fg"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        {t("banner")}
      </p>

      {all.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("list.empty")}</p>
        </Card>
      ) : (
        <>
          <form
            method="get"
            aria-label={t("list.filters")}
            className="mb-4 flex flex-wrap items-end gap-3"
          >
            <select
              name="client"
              aria-label={t("list.client")}
              defaultValue={clientSlug}
              className={`${controlClass} w-auto`}
            >
              <option value="">{t("list.allClients")}</option>
              {clientsInList.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
            <select
              name="status"
              aria-label={t("list.status")}
              defaultValue={status ?? ""}
              className={`${controlClass} w-auto`}
            >
              <option value="">{t("list.allStatuses")}</option>
              {automationStatuses.map((s) => (
                <option key={s} value={s}>
                  {t(`statusLabel.${s}`)}
                </option>
              ))}
            </select>
            <select
              name="source"
              aria-label={t("new.source")}
              defaultValue={source ?? ""}
              className={`${controlClass} w-auto`}
            >
              <option value="">{t("list.allSources")}</option>
              {automationSources.map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}`)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" size="sm">
              {t("list.apply")}
            </Button>
            {filtered ? (
              <Link href="/automations" className="text-body-sm text-link">
                {t("list.clearFilters")}
              </Link>
            ) : null}
          </form>

          {rows.length === 0 ? (
            <Card className="p-6">
              <p className="text-body-md text-fg-muted">{t("list.emptyFiltered")}</p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
              <table className="w-full text-left text-body-sm">
                <thead className="border-b border-subtle text-label text-fg-muted">
                  <tr>
                    {(
                      [
                        "name",
                        "client",
                        "status",
                        "lastRun",
                        "outcome",
                        "stopAt",
                        "cost",
                        "createdBy",
                      ] as const
                    ).map((c) => (
                      <th key={c} scope="col" className="px-4 py-3 font-medium">
                        {t(`list.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const run = a.lastRun;
                    const c = run?.counts;
                    const done = c ? c.completed + c.failed + c.cancelled : 0;
                    const policy = policyOf.get(a.clientId);
                    return (
                      <tr key={a.id} className="border-b border-subtle align-top last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/automations/${a.id}` as Route}
                            className="font-medium text-link"
                          >
                            {a.name}
                          </Link>
                          <p className="text-fg-muted">
                            {t("sourceCount", { source: a.source, count: a.itemCount })}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-fg">{a.clientName}</p>
                          {policy ? <p className="text-fg-muted">{tp(policy)}</p> : null}
                        </td>
                        <td className="px-4 py-3">
                          <AutomationStatusBadge status={a.status} />
                        </td>
                        <td className="px-4 py-3">
                          {run ? (
                            <>
                              <p className="text-fg">
                                {t(`runStatus.${run.status}`, {
                                  done,
                                  total: c?.total ?? 0,
                                })}
                              </p>
                              <p className="text-fg-muted">
                                {format.date(run.startedAt, "dateTime")}
                              </p>
                            </>
                          ) : (
                            <span className="text-fg-muted">{t("list.never")}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-fg">
                          {c ? t("outcome", { completed: c.completed, failed: c.failed }) : "—"}
                        </td>
                        <td className="px-4 py-3 text-fg">{t(`stopAt.${a.stopAt}`)}</td>
                        <td className="px-4 py-3 text-fg">
                          {run
                            ? t("list.costValue", {
                                actual: money(c?.costMicroUsd ?? 0),
                                estimate: money(run.estimateMicroUsd),
                              })
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-fg-muted">
                          {t("list.createdByValue", {
                            name:
                              (a.createdBy && creators.get(a.createdBy)) || t("list.unknownUser"),
                            date: format.date(a.createdAt),
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
