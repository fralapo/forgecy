import {
  listBackups,
  nightlyBackupEnabled,
  NIGHTLY_HOUR,
  NIGHTLY_RETENTION_DAYS,
  systemBackupJob,
} from "@forgecy/backup";
import { and, databaseInfo, desc, eq, getDb, inArray, jobs, sql, users } from "@forgecy/db";
import { resolveMediaRoot } from "@forgecy/files";
import { Badge, Card } from "@forgecy/ui";
import { Download } from "lucide-react";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat, refText } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { diskSpace } from "../storage/usage";
import { CreateBackupForm, DeleteBackupButton, NightlySwitch, RefreshWhileRunning } from "./forms";

export async function generateMetadata() {
  const t = await getTranslations("admin.backup");
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

const RESTORE_CMD = "pnpm forgecy restore <file.tar.gz> --yes";
const DAY_MS = 86_400_000;

function olderThanADay(date: Date | undefined): boolean {
  return !date || Date.now() - date.getTime() > DAY_MS;
}

export default async function BackupPage() {
  const user = await requireUser();
  const t = await getTranslations("admin.backup");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const format = await getFormat();
  const db = getDb();
  const dataDir = resolveMediaRoot(env.FORGECY_DATA_DIR);
  const [backups, nightlyOn, active, lastNightly, space, dbInfo, people] = await Promise.all([
    listBackups(dataDir),
    nightlyBackupEnabled(db),
    db
      .select({ id: jobs.id, status: jobs.status, progress: jobs.progress })
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, systemBackupJob.kind),
          inArray(jobs.status, ["queued", "running", "retrying"]),
        ),
      )
      .limit(1),
    db
      .select({
        status: jobs.status,
        error: jobs.error,
        errorRef: jobs.errorRef,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.kind, systemBackupJob.kind), sql`${jobs.payload}->>'kind' = 'nightly'`))
      .orderBy(desc(jobs.createdAt))
      .limit(1),
    diskSpace(dataDir),
    databaseInfo(db).catch(() => null),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const running = active[0];
  const nightly = lastNightly[0];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const latest = backups[0];
  const bytes = (n: number) =>
    n >= 1e9
      ? t("size.gb", { value: format.number(n / 1e9, { maximumFractionDigits: 1 }) })
      : n >= 1e6
        ? t("size.mb", { value: format.number(n / 1e6, { maximumFractionDigits: 1 }) })
        : t("size.kb", { value: format.number(Math.ceil(n / 1e3)) });
  const stale = olderThanADay(latest?.createdAt);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <RefreshWhileRunning active={Boolean(running)} />
      <p className="mb-6 text-body-sm text-fg">
        {latest
          ? t("latest", {
              date: format.date(latest.createdAt, "dateTime"),
              size: bytes(latest.sizeBytes),
              kind: t(`kind.${latest.kind}`),
            })
          : t("none")}
      </p>
      {stale || nightly?.status === "failed" ? (
        <p role="status" className="mb-6 rounded-md bg-warning-fill p-3 text-body-sm text-fg">
          {nightly?.status === "failed" ? t("nightlyFailed") : t("stale")}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("create.title")}</h2>
          <p className="mt-2 text-body-sm text-fg-muted">{t("create.scope")}</p>
          {dbInfo || space ? (
            <p className="mt-2 text-body-sm text-fg-muted">
              {dbInfo ? t("create.dbSize", { size: bytes(dbInfo.sizeBytes) }) : null}{" "}
              {space ? t("create.free", { size: bytes(space.freeBytes) }) : null}
            </p>
          ) : null}
          <CreateBackupForm running={running ? (running.progress ?? 0) : null} />
          <p className="mt-4 text-body-sm text-fg-muted">{t("create.envNote")}</p>
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("nightly.title")}</h2>
          <p className="mt-2 text-body-sm text-fg">
            {t(nightlyOn ? "nightly.on" : "nightly.off", {
              hour: format.date(new Date(2026, 0, 1, NIGHTLY_HOUR), "time"),
              days: NIGHTLY_RETENTION_DAYS,
            })}
          </p>
          {nightly ? (
            <p className="mt-2 text-body-sm text-fg-muted">
              {nightly.status === "failed"
                ? t("nightly.lastFailed", {
                    date: format.date(nightly.updatedAt, "dateTime"),
                    error: await refText(nightly.errorRef, nightly.error ?? "—"),
                  })
                : t("nightly.last", {
                    date: format.date(nightly.updatedAt, "dateTime"),
                    status: (await getTranslations("enums.jobStatus"))(nightly.status),
                  })}
            </p>
          ) : null}
          <NightlySwitch enabled={nightlyOn} />
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-heading-sm text-fg">{t("list.title")}</h2>
        {backups.length === 0 ? (
          <p className="mt-4 text-body-sm text-fg-muted">{t("list.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead className="text-fg-muted">
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.date")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.kind")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.scope")}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-normal">
                    {t("list.size")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.version")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.by")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t("list.expires")}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    <span className="sr-only">{t("list.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {backups.map((b) => (
                  <tr key={b.name} className="align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-fg">
                      {format.date(b.createdAt, "dateTime")}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge>{t(`kind.${b.kind}`)}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-fg">
                      {t(b.media ? "list.scopeFull" : "list.scopeDb")}
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap text-fg">
                      {bytes(b.sizeBytes)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-fg-muted">
                      {[b.appVersion, b.lastMigration].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-4 text-fg">
                      {(b.createdBy && nameOf.get(b.createdBy)) || t("list.system")}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-fg">
                      {b.expiresAt ? format.date(b.expiresAt) : t("list.never")}
                    </td>
                    <td className="py-2">
                      <span className="flex gap-2">
                        <a
                          href={`/api/system/backups/${b.name}` as Route}
                          className="inline-flex items-center gap-1 text-link underline"
                          download
                        >
                          <Download aria-hidden className="size-4" />
                          {t("list.download")}
                        </a>
                        <DeleteBackupButton name={b.name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-heading-sm text-fg">{t("restore.title")}</h2>
        <p className="mt-2 text-body-sm text-fg-muted">{t("restore.cli")}</p>
        <code className="mt-2 block font-mono text-body-sm text-fg">{RESTORE_CMD}</code>
      </Card>
    </>
  );
}
