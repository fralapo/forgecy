import { databaseInfo, desc, getDb, inArray, jobs, migrationStatus, sql } from "@forgecy/db";
import { queueHealth, redisInfo } from "@forgecy/jobs";
import { smtpOptionsFromEnv } from "@forgecy/mail";
import { Badge, Card } from "@forgecy/ui";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat, refText } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";
import pkg from "@/package.json" with { type: "json" };
import { AdminOnly } from "../_components/admin-only";
import { RefreshButton } from "./refresh-button";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("admin.health");
  return { title: t("title") };
}

type ServiceState = "healthy" | "degraded" | "down" | "not_configured";

const badgeFor: Record<ServiceState, "success" | "warning" | "error" | "neutral"> = {
  healthy: "success",
  degraded: "warning",
  down: "error",
  not_configured: "neutral",
};

const MIGRATE_CMD = "pnpm forgecy migrate";
const UPGRADE_CMD = "pnpm forgecy upgrade";

/** Above this round trip a service counts as slow. */
const SLOW_MS = 500;

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export default async function SystemHealthPage() {
  const user = await requireUser();
  const t = await getTranslations("admin.health");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const format = await getFormat();
  const db = getDb();
  const queuesPromise = settle(getQueues());
  const [dbInfo, migrations, queues, jobCounts, recentFailures] = await Promise.all([
    settle(databaseInfo(db)),
    settle(migrationStatus(db)),
    queuesPromise.then((q) => (q ? settle(queueHealth(q)) : null)),
    settle(
      db
        .select({ status: jobs.status, n: sql<string>`count(*)` })
        .from(jobs)
        .groupBy(jobs.status),
    ),
    settle(
      db
        .select({
          id: jobs.id,
          kind: jobs.kind,
          status: jobs.status,
          error: jobs.error,
          errorRef: jobs.errorRef,
          updatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .where(inArray(jobs.status, ["failed", "needs_attention"]))
        .orderBy(desc(jobs.updatedAt))
        .limit(10),
    ),
  ]);
  const failures = await Promise.all(
    (recentFailures ?? []).map(async (j) => ({
      ...j,
      message: await refText(j.errorRef, j.error ?? "—"),
    })),
  );
  const q = await queuesPromise;
  const redis = q ? await settle(redisInfo(q)) : null;
  const workers = queues ? Math.max(0, ...queues.map((x) => x.workers)) : 0;
  const ms = (n: number) => t("ms", { value: format.number(Math.round(n)) });
  const mb = (n: number) =>
    t("mb", { value: format.number(n / 1e6, { maximumFractionDigits: 1 }) });
  const latencyState = (n: number): ServiceState => (n > SLOW_MS ? "degraded" : "healthy");

  type ServiceKey = "database" | "pgvector" | "redis" | "worker" | "storage" | "smtp";
  const services: { key: ServiceKey; state: ServiceState; details: string[]; href?: Route }[] = [
    {
      key: "database",
      state: dbInfo ? latencyState(dbInfo.latencyMs) : "down",
      details: dbInfo
        ? [
            t("details.postgres", { version: dbInfo.version }),
            t("details.latency", { value: ms(dbInfo.latencyMs) }),
            t("details.connections", {
              used: dbInfo.connections,
              max: dbInfo.maxConnections,
            }),
            t("details.size", { value: mb(dbInfo.sizeBytes) }),
          ]
        : [],
    },
    {
      key: "pgvector",
      state: dbInfo ? (dbInfo.pgvector ? "healthy" : "down") : "down",
      details: dbInfo?.pgvector ? [t("details.version", { version: dbInfo.pgvector })] : [],
    },
    {
      key: "redis",
      state: redis ? latencyState(redis.latencyMs) : "down",
      details: redis
        ? [
            ...(redis.version ? [t("details.version", { version: redis.version })] : []),
            t("details.latency", { value: ms(redis.latencyMs) }),
            ...(redis.usedMemoryBytes !== null
              ? [t("details.memory", { value: mb(redis.usedMemoryBytes) })]
              : []),
          ]
        : [],
    },
    {
      key: "worker",
      state: !queues ? "down" : workers > 0 ? "healthy" : "down",
      details: queues ? [t("details.workers", { count: workers })] : [],
    },
    {
      key: "storage",
      state: "healthy",
      details: [t(env.STORAGE_DRIVER === "local" ? "details.localDisk" : "details.s3")],
      href: "/settings/storage",
    },
    {
      key: "smtp",
      state: smtpOptionsFromEnv(env) ? "healthy" : "not_configured",
      details: [],
      href: "/settings/smtp",
    },
  ];
  const problems = services.filter((s) => s.state === "down" || s.state === "degraded").length;
  const count = (status: string) => Number(jobCounts?.find((r) => r.status === status)?.n ?? 0);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} actions={<RefreshButton />} />
      <p className="mb-6 flex flex-wrap items-center gap-3 text-body-sm text-fg">
        <Badge variant={problems ? "error" : "success"}>
          {problems ? t("overall.problems", { count: problems }) : t("overall.ok")}
        </Badge>
        <span className="text-fg-muted">
          {t("lastCheck", { time: format.date(new Date(), "time") })}
        </span>
      </p>

      <section id="services" aria-labelledby="services-title" className="mb-10">
        <h2 id="services-title" className="mb-4 text-heading-sm text-fg">
          {t("services.title")}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {services.map((s) => (
            <Card key={s.key} className="flex flex-col gap-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-body-md font-semibold text-fg">{t(`services.${s.key}`)}</h3>
                <Badge variant={badgeFor[s.state]}>{t(`state.${s.state}`)}</Badge>
              </div>
              <ul className="text-body-sm text-fg-muted">
                {s.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              {s.state === "down" ? (
                <p className="text-body-sm text-fg">{t(`hint.${s.key}`)}</p>
              ) : null}
              {s.href ? (
                <Link href={s.href} className="mt-auto text-body-sm text-link underline">
                  {t("services.open")}
                </Link>
              ) : null}
            </Card>
          ))}
        </div>
      </section>

      <section id="queue" className="mb-10 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("queue.title")}</h2>
          <dl className="mt-4 grid grid-cols-[12rem_1fr] gap-y-2 text-body-sm">
            {(["queued", "running", "retrying", "failed", "needs_attention"] as const).map((s) => (
              <div key={s} className="contents">
                <dt className="text-fg-muted">{t(`queue.${s}`)}</dt>
                <dd className="text-fg">{format.number(count(s))}</dd>
              </div>
            ))}
          </dl>
          {queues ? (
            <table className="mt-6 w-full text-left text-body-sm">
              <thead className="text-fg-muted">
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2 font-normal">
                    {t("queue.name")}
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    {t("queue.waiting")}
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    {t("queue.active")}
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    {t("queue.workers")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {queues.map((x) => (
                  <tr key={x.name}>
                    <td className="py-2 font-mono text-fg">{x.name}</td>
                    <td className="py-2 text-right text-fg">
                      {format.number(x.waiting + x.delayed)}
                    </td>
                    <td className="py-2 text-right text-fg">{format.number(x.active)}</td>
                    <td className="py-2 text-right text-fg">{format.number(x.workers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
        <Card id="version" className="p-6">
          <h2 className="text-heading-sm text-fg">{t("version.title")}</h2>
          <dl className="mt-4 grid grid-cols-[12rem_1fr] gap-y-2 text-body-sm">
            <dt className="text-fg-muted">{t("version.installed")}</dt>
            <dd className="font-mono text-fg">{pkg.version}</dd>
            <dt className="text-fg-muted">{t("version.migrations")}</dt>
            <dd className="text-fg">
              {migrations
                ? t("version.migrationsApplied", {
                    applied: migrations.applied,
                    total: migrations.total,
                  })
                : t("state.down")}
            </dd>
            {migrations?.lastApplied ? (
              <>
                <dt className="text-fg-muted">{t("version.lastMigration")}</dt>
                <dd className="font-mono text-fg">{migrations.lastApplied}</dd>
              </>
            ) : null}
          </dl>
          {migrations && migrations.pending.length > 0 ? (
            <p role="alert" className="mt-4 rounded-md bg-warning-fill p-3 text-body-sm text-fg">
              {t("version.pending", { count: migrations.pending.length })}{" "}
              <code className="font-mono">{MIGRATE_CMD}</code>
            </p>
          ) : null}
          <p className="mt-4 text-body-sm text-fg-muted">
            {t("version.upgradeHint")} <code className="font-mono">{UPGRADE_CMD}</code>
          </p>
        </Card>
      </section>

      <section id="logs">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("failures.title")}</h2>
          {failures.length === 0 ? (
            <p className="mt-4 text-body-sm text-fg-muted">{t("failures.empty")}</p>
          ) : (
            <table className="mt-4 w-full text-left text-body-sm">
              <thead className="text-fg-muted">
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("failures.when")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("failures.kind")}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    {t("failures.error")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {failures.map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-fg">
                      {format.date(j.updatedAt, "dateTime")}
                    </td>
                    <td className="py-2 pr-4 font-mono text-fg">{j.kind}</td>
                    <td className="py-2 break-words text-fg-muted">{j.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </>
  );
}
