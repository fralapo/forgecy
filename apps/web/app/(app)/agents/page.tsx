import { AGENT_CAPABILITIES, AGENT_ORDER } from "@forgecy/ai";
import { Badge, Button } from "@forgecy/ui";
import { Bot, Brain, Info } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { loadAgentsView, modelLabel } from "./_components/data";

export async function generateMetadata() {
  const t = await getTranslations("agents");
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

const columns = [
  "agent",
  "roleColumn",
  "permissions",
  "model",
  "instructions",
  "runs",
  "cost",
  "statusColumn",
] as const;

/** Agents list (spec page 54): every user reads it, costs included. */
export default async function AgentsPage() {
  const user = await requireUser();
  const t = await getTranslations("agents");
  const tp = await getTranslations("settings.providers");
  const format = await getFormat();
  const { configs, stats, taskModels } = await loadAgentsView(tp("localModel"));
  const money = (micro: number) =>
    format.number(micro / 1_000_000, { style: "currency", currency: "USD" });
  const active = AGENT_ORDER.filter((a) => configs[a].active).length;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="secondary">
            <Link href={"/agents/all/memory" as Route}>
              <Brain aria-hidden />
              {t("memory.openAll")}
            </Link>
          </Button>
        }
      />
      <p className="-mt-6 mb-6 text-body-sm text-fg-muted">{t("activeCount", { count: active })}</p>
      <p
        role="note"
        className="mb-6 flex items-start gap-2 rounded-md border border-subtle bg-surface p-3 text-body-sm text-fg"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span>
          {t("banner")} {user.isAdmin ? t("bannerAdmin") : null}
        </span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-subtle text-label text-fg-muted">
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-3 font-medium">
                  {t(`list.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AGENT_ORDER.map((a) => {
              const c = configs[a];
              const s = stats[a];
              const models = taskModels(a);
              const distinct = new Set(models.map((m) => modelLabel(m.primary)));
              return (
                <tr key={a} className="border-b border-subtle align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/agents/${a}` as Route}
                      className="flex items-start gap-2 text-link"
                      aria-label={t("list.open", { name: t(`name.${a}`) })}
                    >
                      <Bot aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span className="grid">
                        <span className="font-medium">{t(`name.${a}`)}</span>
                        <span className="font-mono text-fg-muted">{a}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="min-w-64 max-w-sm px-4 py-3 text-fg">{t(`role.${a}`)}</td>
                  <td className="px-4 py-3">
                    <ul className="flex flex-wrap gap-1">
                      {AGENT_CAPABILITIES[a].map((cap) => (
                        <li
                          key={cap}
                          className="rounded-sm border border-subtle px-2 py-0.5 font-mono text-fg"
                        >
                          {t(`capability.${cap}`)}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3 font-mono text-fg">
                    {models.length === 0
                      ? t("list.noTasks")
                      : distinct.size > 1
                        ? t("list.variesByTask")
                        : modelLabel(models[0]?.primary) || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-fg">
                    {c.published?.text.trim()
                      ? t("list.version", { version: c.published.version })
                      : t("list.noInstructions")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg">
                    {t("list.runsValue", { runs: s.runs })}
                    {s.failed ? (
                      <span className="block text-error">
                        {t("list.failedValue", { failed: s.failed })}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg">
                    {money(s.monthCostMicroUsd)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.active ? "success" : "neutral"}>
                      {t(c.active ? "status.active" : "status.inactive")}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
