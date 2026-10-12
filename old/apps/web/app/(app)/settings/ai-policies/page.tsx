import {
  connectedMcpProviders,
  budgetPercent,
  getBudgetOverview,
  getCatalogAiEnabled,
  getDefaultAiPolicy,
  restrictableProviders,
  type BudgetLine,
} from "@forgecy/ai";
import { aiPolicies, type AiPolicy, type ProviderId } from "@forgecy/core";
import { eq, getDb, users } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { Ban, Cloud, Server, Shield, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { UsageBar } from "../_components/usage-bar";
import {
  ApprovedProvidersForm,
  SendableAssetsForm,
  BudgetForm,
  CatalogAiGateForm,
  ClientPolicySelect,
  DefaultPolicyForm,
  type ProviderChoice,
} from "./forms";

export async function generateMetadata() {
  const t = await getTranslations("admin.aiPolicies");
  return { title: t("title") };
}

const policyIcon: Record<AiPolicy, LucideIcon> = {
  external_allowed: Cloud,
  external_restricted: Shield,
  local_only: Server,
  no_ai: Ban,
};

const usd = (microUsd: number) => microUsd / 1_000_000;

const providerName: Record<Exclude<ProviderId, "local">, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  deepseek: "DeepSeek",
  higgsfield: "Higgsfield (MCP)",
};

function providerChoices(connectedMcp: ReadonlySet<string>): ProviderChoice[] {
  const keys: Record<Exclude<ProviderId, "local">, string | undefined> = {
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    google: env.GOOGLE_AI_API_KEY,
    deepseek: env.DEEPSEEK_API_KEY,
    higgsfield: connectedMcp.has("higgsfield") ? "connected" : undefined,
  };
  return restrictableProviders.flatMap((id) =>
    id === "local" ? [] : [{ id, name: providerName[id], configured: Boolean(keys[id]) }],
  );
}

export default async function AiPoliciesPage() {
  const user = await requireUser();
  const t = await getTranslations("admin.aiPolicies");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const te = await getTranslations("enums");
  const format = await getFormat();
  const db = getDb();
  const [overview, defaultPolicy, catalogAiEnabled] = await Promise.all([
    getBudgetOverview(db),
    getDefaultAiPolicy(db),
    getCatalogAiEnabled(db),
  ]);
  const setBy = defaultPolicy.updatedBy
    ? await db.query.users.findFirst({
        where: eq(users.id, defaultPolicy.updatedBy),
        columns: { name: true },
      })
    : undefined;

  const money = (microUsd: number) => format.currency(usd(microUsd), "USD");
  const cents = (c: number) => format.currency(c / 100, "USD");
  const spentText = (line: BudgetLine) => {
    const percent = budgetPercent(line);
    return line.limitCents && percent !== null
      ? t("spent", {
          percent: format.number(Math.round(percent)),
          spent: money(line.spentMicroUsd),
          limit: cents(line.limitCents),
        })
      : t("spentNoLimit", { spent: money(line.spentMicroUsd) });
  };
  const statusBadge = (line: BudgetLine) => {
    const percent = budgetPercent(line);
    if (percent === null) return null;
    if (percent >= 100) return <Badge variant="error">{t("exhausted")}</Badge>;
    if (percent >= line.warnAtPercent) return <Badge variant="warning">{t("warning")}</Badge>;
    return null;
  };

  const monthName = format.date(`${overview.month}T12:00:00Z`, "month");
  const agency = overview.agency;
  const agencyPercent = budgetPercent(agency);
  // Linear forecast: month-to-date spend spread over the days elapsed so far.
  const now = new Date();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const elapsed = now.getUTCDate() - 1 + now.getUTCHours() / 24;
  const forecast = elapsed > 0 ? (agency.spentMicroUsd / elapsed) * daysInMonth : 0;
  const counts = new Map<AiPolicy, number>();
  for (const c of overview.clients) counts.set(c.aiPolicy, (counts.get(c.aiPolicy) ?? 0) + 1);
  const localMissing = !env.LOCAL_LLM_ENABLED && counts.get("local_only");
  const choices = providerChoices(await connectedMcpProviders(db));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="mb-8 flex flex-wrap items-center gap-3 text-body-sm text-fg">
        <span>
          {agency.limitCents && agencyPercent !== null
            ? t("monthSpend", {
                month: monthName,
                spent: money(agency.spentMicroUsd),
                limit: cents(agency.limitCents),
                percent: format.number(Math.round(agencyPercent)),
              })
            : t("monthSpendNoLimit", { month: monthName, spent: money(agency.spentMicroUsd) })}
        </span>
        {statusBadge(agency)}
      </div>

      <section id="policies" aria-labelledby="policies-title" className="mb-10">
        <h2 id="policies-title" className="mb-4 text-heading-sm text-fg">
          {t("policies.title")}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {aiPolicies.map((p) => {
            const Icon = policyIcon[p];
            return (
              <Card key={p} className="flex flex-col gap-2 p-5">
                <h3 className="flex items-center gap-2 text-body-md font-semibold text-fg">
                  <Icon aria-hidden className="size-5 text-fg-muted" />
                  {te(`aiPolicy.${p}`)}
                </h3>
                <p className="text-body-sm text-fg-muted">{t(`policies.${p}`)}</p>
                <p className="mt-auto text-body-sm text-fg">
                  {t("policies.clients", { count: counts.get(p) ?? 0 })}
                </p>
              </Card>
            );
          })}
        </div>
      </section>

      <section id="default" className="mb-10">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("default.title")}</h2>
          <p className="mt-2 text-body-sm text-fg-muted">{t("default.hint")}</p>
          <p className="mt-2 text-body-sm text-fg-muted">
            {defaultPolicy.updatedAt
              ? t("default.setBy", {
                  name: setBy?.name ?? "—",
                  date: format.date(defaultPolicy.updatedAt, "dateTime"),
                })
              : t("default.neverSet")}
          </p>
          <DefaultPolicyForm current={defaultPolicy.policy} />
        </Card>
      </section>

      <section id="catalog-ai" className="mb-10">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("catalogAi.title")}</h2>
          <p className="mt-2 text-body-sm text-fg-muted">{t("catalogAi.description")}</p>
          <CatalogAiGateForm enabled={catalogAiEnabled} />
        </Card>
      </section>

      <section id="budgets" className="mb-10">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("agency.title")}</h2>
          {agency.limitCents === null ? (
            <p role="status" className="mt-3 rounded-md bg-warning-fill p-3 text-body-sm text-fg">
              {t("agency.noBudget")}
            </p>
          ) : (
            <div className="mt-4 flex max-w-xl flex-col gap-2">
              <UsageBar percent={agencyPercent ?? 0} label={spentText(agency)} />
              <p className="text-body-sm text-fg">{spentText(agency)}</p>
              <p className="text-body-sm text-fg-muted">
                {t("agency.forecast", { amount: money(forecast) })}
              </p>
            </div>
          )}
          <div className="mt-4">
            <BudgetForm clientId={null} current={agency.limitCents} label={t("agency.label")} />
          </div>
          <p className="mt-3 text-body-sm text-fg-muted">{t("agency.hint")}</p>
          <p className="mt-1 text-body-sm text-fg-muted">{t("agency.thresholds")}</p>
          <p className="mt-1 text-body-sm text-fg-muted">{t("agency.monthReset")}</p>
        </Card>
      </section>

      <section id="clients">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("clients.title")}</h2>
          {localMissing ? (
            <p role="alert" className="mt-3 rounded-md bg-warning-fill p-3 text-body-sm text-fg">
              {t("clients.localMissing")}
            </p>
          ) : null}
          {overview.clients.length === 0 ? (
            <p className="mt-4 text-body-sm text-fg-muted">{t("clients.empty")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-body-sm">
                <thead className="text-fg-muted">
                  <tr className="border-b border-subtle">
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t("clients.name")}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t("clients.policy")}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-normal">
                      {t("clients.budget")}
                    </th>
                    <th scope="col" className="py-2 font-normal">
                      {t("clients.spend")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {overview.clients.map((c) => (
                    <tr key={c.clientId} className="align-top">
                      <td className="py-3 pr-4">
                        <Link href={`/clients/${c.slug}` as Route} className="text-link underline">
                          {c.name}
                        </Link>
                        <span className="block text-fg-muted">
                          {te(`clientStatus.${c.status}`)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <ClientPolicySelect
                          clientId={c.clientId}
                          name={c.name}
                          policy={c.aiPolicy}
                        />
                        {c.aiPolicy === "external_restricted" ? (
                          <ApprovedProvidersForm
                            clientId={c.clientId}
                            name={c.name}
                            choices={choices}
                            approved={c.approvedProviders}
                          />
                        ) : null}
                        {c.aiPolicy === "external_restricted" ? (
                          <SendableAssetsForm
                            clientId={c.clientId}
                            name={c.name}
                            sendable={c.sendableAssets}
                          />
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <BudgetForm
                          clientId={c.clientId}
                          current={c.limitCents}
                          label={t("clients.budgetFor", { name: c.name })}
                          hideLabel
                        />
                        {c.limitCents === null ? (
                          <p className="mt-1 text-body-sm text-fg-muted">
                            {t("clients.noClientLimit")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <div className="flex min-w-40 flex-col gap-1">
                          {c.limitCents ? (
                            <UsageBar percent={budgetPercent(c) ?? 0} label={spentText(c)} />
                          ) : null}
                          <span className="flex items-center gap-2 text-fg">
                            {spentText(c)} {statusBadge(c)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
