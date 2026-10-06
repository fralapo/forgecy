import { aiTasks, getAgentRun, type AiTask } from "@forgecy/ai";
import { aiPolicies } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { ArrowLeft, Bot, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { CopyButton } from "../../_components/copy-button";

export const dynamic = "force-dynamic";

const runVariant = { ok: "success", error: "error", blocked: "warning" } as const;
const REASONS = ["no_ai", "local_unavailable", "agent_disabled", "budget_exceeded"] as const;
const FIELD_NAMES = ["system", "input", "prompt"] as const;

const digestSchema = z.record(z.string(), z.object({ sha256: z.string(), bytes: z.number() }));
const summarySchema = z
  .object({
    fields: digestSchema.optional(),
    assets: z.array(z.object({ id: z.string(), sha256: z.string().optional() })).optional(),
    images: z
      .array(z.object({ sha256: z.string(), bytes: z.number(), mimeType: z.string() }))
      .optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    schema: z.object({ name: z.string(), sha256: z.string() }).optional(),
    agent: z.object({ instructionsVersion: z.number().nullable().optional() }).optional(),
    blockedReason: z.string().optional(),
    fallback: z.boolean().optional(),
  })
  .partial();

/** Agent run details (spec page 57): what was asked, sent, returned and paid. */
export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireUser();
  const id = z.uuid().safeParse((await params).runId);
  if (!id.success) notFound();
  const detail = await getAgentRun(getDb(), id.data);
  if (!detail) notFound();
  const { run, agent } = detail;
  const t = await getTranslations("agents");
  const te = await getTranslations("enums");
  const format = await getFormat();
  const summary = summarySchema.safeParse(run.inputSummary).data ?? {};
  const taskLabel =
    (aiTasks as readonly string[]).includes(run.kind) || run.kind === "image"
      ? t(`task.${run.kind as AiTask | "image"}`)
      : run.kind;
  const agentName = agent ? t(`name.${agent}`) : null;
  const size = (bytes: number) =>
    bytes < 1024
      ? format.number(bytes, { style: "unit", unit: "byte" })
      : format.number(bytes / 1024, { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 });
  const fieldLabel = (name: string) =>
    (FIELD_NAMES as readonly string[]).includes(name)
      ? t(`run.fieldName.${name as (typeof FIELD_NAMES)[number]}`)
      : name;
  const reason = summary.blockedReason
    ? t(
        `run.reason.${(REASONS as readonly string[]).includes(summary.blockedReason) ? (summary.blockedReason as (typeof REASONS)[number]) : "other"}`,
      )
    : null;
  const policy =
    run.policy && (aiPolicies as readonly string[]).includes(run.policy) ? run.policy : null;
  const durationMs = run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null;
  const money = format.number(run.costMicroUsd / 1_000_000, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  const meta = summary.meta ?? {};
  const fields = Object.entries(summary.fields ?? {});
  const instructionsVersion = summary.agent?.instructionsVersion ?? null;

  const block = (title: string, children: ReactNode) => (
    <Card className="grid gap-3 p-6">
      <h2 className="text-heading-sm text-fg">{title}</h2>
      {children}
    </Card>
  );
  const row = (label: string, value: ReactNode) => (
    <div className="contents">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{value}</dd>
    </div>
  );
  const technical = [
    `${t("run.id")}: ${run.id}`,
    `${t("run.status")}: ${t(`runs.statusValue.${run.status}`)}`,
    `${t("run.task")}: ${run.kind}`,
    `${t("run.provider")}: ${run.provider ?? "—"}`,
    `${t("run.model")}: ${run.model ?? "—"}`,
    `${t("run.tokensIn")}: ${run.tokensIn}`,
    `${t("run.tokensOut")}: ${run.tokensOut}`,
    `${t("run.cost")}: ${money}`,
  ].join("\n");

  return (
    <>
      <Link
        href={(agent ? `/agents/${agent}?tab=runs` : "/agents") as Route}
        className="mb-4 inline-flex items-center gap-1 text-body-sm text-link"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {agentName ?? t("run.breadcrumb")}
      </Link>
      <PageHeader
        title={
          agentName
            ? t("run.title", { agent: agentName, task: taskLabel })
            : t("run.titleNoAgent", { task: taskLabel })
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={runVariant[run.status]}>{t(`runs.statusValue.${run.status}`)}</Badge>
            {policy ? <Badge variant="neutral">{te(`aiPolicy.${policy}`)}</Badge> : null}
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 content-start gap-6">
          {block(
            t("run.context"),
            <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 text-body-sm">
              {row(
                t("run.agent"),
                agent ? (
                  <Link
                    href={`/agents/${agent}` as Route}
                    className="inline-flex items-center gap-1 text-link"
                  >
                    <Bot aria-hidden className="size-4" />
                    {agentName}
                  </Link>
                ) : (
                  "—"
                ),
              )}
              {row(
                t("run.task"),
                <>
                  {taskLabel} <span className="font-mono text-fg-muted">{run.kind}</span>
                </>,
              )}
              {row(
                t("run.client"),
                detail.clientSlug ? (
                  <Link href={`/clients/${detail.clientSlug}` as Route} className="text-link">
                    {detail.clientName}
                  </Link>
                ) : (
                  t("run.noClient")
                ),
              )}
              {typeof meta.action === "string"
                ? row(t("run.action"), <span className="font-mono">{meta.action}</span>)
                : null}
              {typeof meta.promptVersion === "string" || typeof meta.promptVersion === "number"
                ? row(
                    t("run.promptVersion"),
                    <span className="font-mono">{String(meta.promptVersion)}</span>,
                  )
                : null}
              {row(
                t("run.instructions"),
                <span className="font-mono">
                  {instructionsVersion
                    ? t("list.version", { version: instructionsVersion })
                    : t("list.noInstructions")}
                </span>,
              )}
              {detail.job
                ? row(
                    t("run.job"),
                    <span className="font-mono">
                      {detail.job.kind} · {detail.job.id.slice(0, 8)}
                    </span>,
                  )
                : null}
            </dl>,
          )}
          {block(
            t("run.authorization"),
            <>
              <p className="text-body-sm text-fg">
                {detail.startedBy
                  ? t("run.startedBy", {
                      name: detail.startedBy,
                      date: format.date(run.startedAt, "dateTime"),
                    })
                  : t("run.startedBySystem", { date: format.date(run.startedAt, "dateTime") })}
              </p>
              <p className="flex items-start gap-2 text-body-sm text-fg-muted">
                <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {t("run.neverAgent")}
              </p>
            </>,
          )}
          {block(
            t("run.inputs"),
            <>
              <p className="text-body-sm text-fg-muted">{t("run.inputsIntro")}</p>
              {fields.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-body-sm">
                    <thead className="border-b border-subtle text-label text-fg-muted">
                      <tr>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          {t("run.field")}
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          {t("run.size")}
                        </th>
                        <th scope="col" className="py-2 pr-4 font-medium">
                          {t("run.hash")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map(([name, d]) => (
                        <tr key={name} className="border-b border-subtle last:border-0">
                          <td className="py-2 pr-4 text-fg">{fieldLabel(name)}</td>
                          <td className="whitespace-nowrap py-2 pr-4 text-fg">{size(d.bytes)}</td>
                          <td className="py-2 pr-4 font-mono text-fg-muted">
                            {d.sha256.slice(0, 12)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {summary.images?.length ? (
                <div>
                  <h3 className="text-label text-fg-muted">{t("run.images")}</h3>
                  <ul className="mt-1 grid gap-1 text-body-sm text-fg">
                    {summary.images.map((img) => (
                      <li key={img.sha256}>
                        {img.mimeType} · {size(img.bytes)} ·{" "}
                        <span className="font-mono text-fg-muted">{img.sha256.slice(0, 12)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.assets?.length ? (
                <div>
                  <h3 className="text-label text-fg-muted">{t("run.assets")}</h3>
                  <ul className="mt-1 grid gap-1 font-mono text-body-sm text-fg">
                    {summary.assets.map((a) => (
                      <li key={a.id}>
                        {a.id.slice(0, 8)}
                        {a.sha256 ? ` · ${a.sha256.slice(0, 12)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {summary.schema ? (
                <p className="text-body-sm text-fg">
                  {t("run.schema")}: <span className="font-mono">{summary.schema.name}</span>
                </p>
              ) : null}
              <p className="text-body-sm text-fg-muted">{t("run.noSecrets")}</p>
            </>,
          )}
          {block(
            t("run.output"),
            run.resultRef ? (
              <p className="text-body-sm text-fg">
                {t("run.outputRef")}: <span className="font-mono">{run.resultRef}</span>
              </p>
            ) : (
              <p className="text-body-sm text-fg-muted">{t("run.noOutput")}</p>
            ),
          )}
          {block(
            t("run.errors"),
            <>
              {reason ? (
                <p role="note" className="text-body-sm text-fg">
                  <strong>{t("run.blocked")}</strong> · {reason}
                </p>
              ) : null}
              {run.error ? (
                <p className="break-words font-mono text-body-sm text-error">{run.error}</p>
              ) : null}
              {!run.error && !reason ? (
                <p className="text-body-sm text-fg-muted">
                  {t("run.noErrors", { count: Math.max(1, detail.attempts.length) })}
                </p>
              ) : null}
              {detail.attempts.length > 1 ? (
                <div>
                  <h3 className="text-label text-fg-muted">{t("run.attemptsTitle")}</h3>
                  <ol className="mt-2 grid gap-1 text-body-sm">
                    {detail.attempts.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-fg">{format.date(a.startedAt, "dateTime")}</span>
                        <Badge variant={runVariant[a.status]}>
                          {t(`runs.statusValue.${a.status}`)}
                        </Badge>
                        <span className="font-mono text-fg-muted">
                          {a.provider && a.model ? `${a.provider} · ${a.model}` : "—"}
                        </span>
                        {a.id === run.id ? (
                          <span className="text-fg-muted">{t("run.current")}</span>
                        ) : (
                          <Link href={`/agents/runs/${a.id}` as Route} className="text-link">
                            {t("run.openRun")}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </>,
          )}
        </div>
        <aside className="grid content-start gap-6">
          <Card className="grid gap-4 p-6">
            <h2 className="text-heading-sm text-fg">{t("run.summary")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body-sm">
              {row(t("run.id"), <span className="font-mono">{run.id}</span>)}
              {row(t("run.provider"), <span className="font-mono">{run.provider ?? "—"}</span>)}
              {row(t("run.model"), <span className="font-mono">{run.model ?? "—"}</span>)}
              {row(t("run.policy"), policy ? te(`aiPolicy.${policy}`) : "—")}
              {row(t("run.started"), format.date(run.startedAt, "dateTime"))}
              {row(t("run.ended"), run.endedAt ? format.date(run.endedAt, "dateTime") : "—")}
              {row(
                t("run.duration"),
                durationMs === null
                  ? "—"
                  : t("run.seconds", { value: Math.round(durationMs / 100) / 10 }),
              )}
              {row(t("run.tokensIn"), format.number(run.tokensIn))}
              {row(t("run.tokensOut"), format.number(run.tokensOut))}
              {row(t("run.cost"), money)}
            </dl>
            <div className="flex flex-wrap gap-4">
              <CopyButton value={run.id} label={t("run.copy")} copied={t("run.copied")} />
              <CopyButton value={technical} label={t("run.copySummary")} copied={t("run.copied")} />
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
