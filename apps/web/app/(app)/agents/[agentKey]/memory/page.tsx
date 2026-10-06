import {
  AGENT_ORDER,
  getMemory,
  listMemories,
  loadClientMemorySettings,
  memoryCounts,
  type MemoryRow,
  type MemoryStatusFilter,
} from "@forgecy/ai";
import { FORMATS } from "@forgecy/carousel";
import { contentLanguages, releasedFormats } from "@forgecy/content";
import {
  agentKeySchema,
  ctaKinds,
  DEFAULT_CTA_MAX,
  MEMORY_CONTENT_MAX,
  memoryCategories,
  memorySettingKeys,
  memoryStatuses,
  SLIDE_COUNT_MAX,
  SLIDE_COUNT_MIN,
  type AgentRole,
  type MemoryStatus,
} from "@forgecy/core";
import { asc, clients, getDb, isNull } from "@forgecy/db";
import { Badge, Card, cn } from "@forgecy/ui";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { controlClass } from "../../../content/_components/action-button";
import {
  AddMemoryForm,
  MemoryActions,
  MemoryList,
  MemorySettingsForm,
  type MemoryCard,
  type SettingRow,
} from "../../_components/memory";

export const dynamic = "force-dynamic";

const statusFilters = ["default", "all", ...memoryStatuses] as const;
const statusVariant: Record<MemoryStatus, MemoryCard["statusVariant"]> = {
  observed: "neutral",
  candidate: "warning",
  approved: "success",
  rejected: "error",
  archived: "neutral",
};

export async function generateMetadata({ params }: { params: Promise<{ agentKey: string }> }) {
  const t = await getTranslations("agents");
  const key = agentKeySchema.safeParse((await params).agentKey);
  return {
    title: key.success
      ? t("memory.titleAgent", { name: t(`name.${key.data}`) })
      : t("memory.title"),
  };
}

/**
 * Agent memory (spec page 56): what the agents reuse for a client. `/agents/all/memory`
 * shows every agent. Only approved memories reach the prompts.
 */
export default async function AgentMemoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentKey: string }>;
  searchParams: Promise<{ client?: string; status?: string; m?: string }>;
}) {
  await requireUser();
  const raw = (await params).agentKey;
  const parsedKey = agentKeySchema.safeParse(raw);
  if (raw !== "all" && !parsedKey.success) notFound();
  const agent: AgentRole | undefined = parsedKey.success ? parsedKey.data : undefined;
  const base = `/agents/${agent ?? "all"}/memory`;
  const sp = await searchParams;
  const status: MemoryStatusFilter = statusFilters.find((s) => s === sp.status) ?? "default";

  const db = getDb();
  const t = await getTranslations("agents");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const clientList = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(isNull(clients.archivedAt))
    .orderBy(asc(clients.name));
  const client = clientList.find((c) => c.slug === sp.client);
  const selectedId = z.uuid().safeParse(sp.m);

  const [rows, counts, detail, settings] = await Promise.all([
    listMemories(db, { agent, clientId: client?.id, status }),
    memoryCounts(db, { agent, clientId: client?.id }),
    selectedId.success ? getMemory(db, selectedId.data) : null,
    client ? loadClientMemorySettings(db, client.id) : null,
  ]);

  const agentName = (a: AgentRole) => t(`name.${a}`);
  const query = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = {
      client: client?.slug,
      status: status === "default" ? undefined : status,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };
  const origin = (m: MemoryRow) => {
    const date = format.date(m.createdAt, "date");
    if (m.proposedByAgent)
      return t(m.status === "observed" ? "memory.observedBy" : "memory.proposedBy", {
        agent: agentName(m.proposedByAgent),
        date,
      });
    return m.createdByName
      ? t("memory.addedBy", { name: m.createdByName, date })
      : t("memory.addedByUnknown", { date });
  };
  const cards: MemoryCard[] = rows.map((m) => ({
    id: m.id,
    href: `${base}${query({ m: m.id })}`,
    content: m.content,
    status: m.status,
    statusLabel: t(`memory.status.${m.status}`),
    statusVariant: statusVariant[m.status],
    category: t(`memory.category.${m.category}`),
    sensitive: m.sensitive,
    meta: [
      ...(client ? [] : [m.clientName]),
      ...(agent ? [] : [t("memory.forAgent", { agent: agentName(m.agent) })]),
      origin(m),
    ].join(" · "),
    confidence: `${t("memory.confidence.label")}: ${t(`memory.confidence.${m.confidence}`)}`,
    version: t("memory.version", { version: m.version }),
    selected: detail?.item.id === m.id,
    bulk: m.status === "candidate" && !m.sensitive && m.confidence !== "low",
  }));
  const categories = memoryCategories.map((c) => ({
    value: c,
    label: t(`memory.category.${c}`),
  }));

  const settingRows: SettingRow[] = settings
    ? memorySettingKeys.map((key) => {
        const entry = settings[key];
        return {
          key,
          label: t(`memory.settings.${key}`),
          value: entry?.value ?? null,
          meta: entry
            ? entry.updatedByName
              ? t("memory.settings.meta", {
                  version: entry.version,
                  name: entry.updatedByName,
                  date: format.date(entry.updatedAt, "date"),
                })
              : t("memory.settings.metaNoName", {
                  version: entry.version,
                  date: format.date(entry.updatedAt, "date"),
                })
            : null,
        };
      })
    : [];

  const title = agent ? t("memory.titleAgent", { name: agentName(agent) }) : t("memory.title");
  const item = detail?.item;

  return (
    <>
      <Link
        href={(agent ? `/agents/${agent}` : "/agents") as Route}
        className="mb-4 inline-flex items-center gap-1 text-body-sm text-link"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {agent ? agentName(agent) : t("detail.back")}
      </Link>
      <PageHeader
        title={title}
        description={t("memory.onlyApproved")}
        actions={
          <AddMemoryForm
            clients={clientList.map((c) => ({ value: c.id, label: c.name }))}
            clientId={client?.id ?? ""}
            agents={AGENT_ORDER.map((a) => ({ value: a, label: agentName(a) }))}
            agent={agent ?? "copywriter"}
            categories={categories}
            max={MEMORY_CONTENT_MAX}
          />
        }
      />
      <p className="-mt-4 mb-2 text-body-md text-fg">
        {t("memory.counts", { candidate: counts.candidate, approved: counts.approved })}
      </p>
      {counts.candidate > 0 ? (
        <p className="mb-6 text-body-sm text-fg-muted">
          {t("memory.nextAction", { count: counts.candidate })}
        </p>
      ) : (
        <div className="mb-6" />
      )}

      <nav aria-label={t("memory.filters.agent")} className="mb-4 flex flex-wrap gap-2">
        {[undefined, ...AGENT_ORDER].map((a) => {
          const current = a === agent;
          return (
            <Link
              key={a ?? "all"}
              href={`/agents/${a ?? "all"}/memory${query({})}` as Route}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-sm border px-3 py-1 text-body-sm",
                current ? "border-primary text-fg" : "border-subtle text-fg-muted hover:text-fg",
              )}
            >
              {a ? agentName(a) : t("memory.filters.allAgents")}
            </Link>
          );
        })}
      </nav>
      <form
        method="get"
        action={base}
        aria-label={t("memory.filters.label")}
        className="mb-6 flex flex-wrap items-end gap-3"
      >
        <div className="grid gap-1">
          <label htmlFor="mem-f-client" className="text-label text-fg">
            {t("memory.filters.client")}
          </label>
          <select
            id="mem-f-client"
            name="client"
            defaultValue={client?.slug ?? ""}
            className={controlClass}
          >
            <option value="">{t("memory.filters.allClients")}</option>
            {clientList.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="mem-f-status" className="text-label text-fg">
            {t("memory.filters.status")}
          </label>
          <select id="mem-f-status" name="status" defaultValue={status} className={controlClass}>
            <option value="default">{t("memory.filters.default")}</option>
            <option value="all">{t("memory.filters.all")}</option>
            {memoryStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`memory.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-11 rounded-md border border-control px-4 text-body-sm text-fg"
        >
          {t("memory.filters.apply")}
        </button>
      </form>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-6">
          {client ? (
            <Card className="grid gap-4 p-6">
              <div>
                <h2 className="text-heading-sm text-fg">{t("memory.settings.title")}</h2>
                <p className="mt-1 text-body-sm text-fg-muted">{t("memory.settings.intro")}</p>
              </div>
              <MemorySettingsForm
                clientId={client.id}
                rows={settingRows}
                formats={releasedFormats.map((f) => ({ value: f, label: FORMATS[f].label }))}
                languages={contentLanguages.map((l) => ({
                  value: l.code,
                  label: tl(`language.${l.code}`),
                }))}
                ctaKinds={ctaKinds.map((k) => ({
                  value: k,
                  label: t(`memory.settings.ctaKinds.${k}`),
                }))}
                slideMin={SLIDE_COUNT_MIN}
                slideMax={SLIDE_COUNT_MAX}
                ctaMax={DEFAULT_CTA_MAX}
              />
            </Card>
          ) : (
            <p className="text-body-sm text-fg-muted">{t("memory.settings.chooseClient")}</p>
          )}
          {cards.length ? (
            <MemoryList items={cards} />
          ) : (
            <Card className="grid gap-2 p-6">
              <p className="text-body-md text-fg">
                {status === "candidate"
                  ? t("memory.empty.candidates")
                  : client && status === "default"
                    ? t("memory.empty.client", { client: client.name })
                    : t("memory.empty.none")}
              </p>
              {status === "candidate" ? (
                <Link
                  href={`${base}${query({ status: "approved" })}` as Route}
                  className="text-body-sm text-link"
                >
                  {t("memory.empty.seeApproved")}
                </Link>
              ) : null}
            </Card>
          )}
        </div>

        <aside aria-labelledby="mem-detail-title">
          <Card className="grid gap-4 p-6">
            <h2 id="mem-detail-title" className="text-heading-sm text-fg">
              {t("memory.detail.title")}
            </h2>
            {item && detail ? (
              <>
                <p className="text-body-md whitespace-pre-wrap text-fg">{item.content}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant[item.status]}>
                    {t(`memory.status.${item.status}`)}
                  </Badge>
                  {item.sensitive ? (
                    <Badge variant="warning" icon={ShieldAlert}>
                      {t("memory.sensitive")}
                    </Badge>
                  ) : null}
                  <span className="font-mono text-body-sm text-fg-muted">
                    {t("memory.version", { version: item.version })}
                  </span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
                  <dt className="text-fg-muted">{t("memory.detail.agent")}</dt>
                  <dd className="text-fg">{agentName(item.agent)}</dd>
                  <dt className="text-fg-muted">{t("memory.detail.client")}</dt>
                  <dd className="text-fg">{item.clientName}</dd>
                  <dt className="text-fg-muted">{t("memory.detail.category")}</dt>
                  <dd className="text-fg">{t(`memory.category.${item.category}`)}</dd>
                  <dt className="text-fg-muted">{t("memory.detail.confidence")}</dt>
                  <dd className="text-fg">
                    {t(`memory.confidence.${item.confidence}`)}
                    {item.confidenceReason ? (
                      <span className="block text-fg-muted">
                        {t("memory.detail.reason", { reason: item.confidenceReason })}
                      </span>
                    ) : null}
                  </dd>
                  <dt className="text-fg-muted">{t("memory.detail.origin")}</dt>
                  <dd className="text-fg">
                    {origin(item)}
                    {item.sourceRunId ? (
                      <Link
                        href={`/agents/runs/${item.sourceRunId}` as Route}
                        className="block text-link"
                      >
                        {t("memory.detail.openRun")}
                      </Link>
                    ) : null}
                    {item.sourceNote ? (
                      <span className="block text-fg-muted">{item.sourceNote}</span>
                    ) : null}
                  </dd>
                  {item.decidedAt ? (
                    <>
                      <dt className="text-fg-muted">{t("memory.detail.decision")}</dt>
                      <dd className="text-fg">
                        {item.decidedByName
                          ? t("memory.detail.decidedBy", {
                              status: t(`memory.status.${item.status}`),
                              name: item.decidedByName,
                              date: format.date(item.decidedAt, "dateTime"),
                            })
                          : t("memory.detail.decidedAt", {
                              status: t(`memory.status.${item.status}`),
                              date: format.date(item.decidedAt, "dateTime"),
                            })}
                        {item.decisionNote ? (
                          <span className="block text-fg-muted">
                            {t("memory.detail.note", { note: item.decisionNote })}
                          </span>
                        ) : null}
                      </dd>
                    </>
                  ) : null}
                </dl>
                {item.sensitive ? (
                  <p className="text-body-sm text-fg-muted">
                    {t("memory.actions.brandHint")}{" "}
                    <Link
                      href={`/brand/${item.clientSlug}/proposals` as Route}
                      className="text-link"
                    >
                      {t("memory.actions.brandProposal")}
                    </Link>
                  </p>
                ) : null}
                <MemoryActions
                  key={`${item.id}-${item.version}-${item.status}`}
                  id={item.id}
                  status={item.status}
                  lowConfidence={item.confidence === "low"}
                  content={item.content}
                  category={item.category}
                  version={item.version}
                  categories={categories}
                />
                <section className="grid gap-2">
                  <h3 className="text-label text-fg">{t("memory.detail.versions")}</h3>
                  <ul className="grid gap-2 text-body-sm">
                    {detail.versions.map((v) => (
                      <li key={v.version} className="grid gap-0.5">
                        <span className="text-fg-muted">
                          {t("memory.detail.versionLine", {
                            version: v.version,
                            author:
                              v.authorName ?? (v.authorAgent ? agentName(v.authorAgent) : "—"),
                            date: format.date(v.createdAt, "dateTime"),
                          })}
                        </span>
                        <span className="text-fg">{v.content}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="grid gap-2">
                  <h3 className="text-label text-fg">{t("memory.detail.usedIn")}</h3>
                  {detail.usedIn.length ? (
                    <ul className="grid gap-1 text-body-sm">
                      {detail.usedIn.map((r) => (
                        <li key={r.id}>
                          <Link href={`/agents/runs/${r.id}` as Route} className="text-link">
                            {format.date(r.startedAt, "dateTime")}
                          </Link>{" "}
                          <span className="text-fg-muted">
                            {t.has(`task.${r.kind}` as "task.slides")
                              ? t(`task.${r.kind}` as "task.slides")
                              : r.kind}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-body-sm text-fg-muted">{t("memory.detail.usedInNone")}</p>
                  )}
                </section>
                <Link href={`${base}${query({})}` as Route} className="text-body-sm text-link">
                  {t("memory.detail.close")}
                </Link>
              </>
            ) : (
              <p className="text-body-sm text-fg-muted">{t("memory.detail.none")}</p>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
