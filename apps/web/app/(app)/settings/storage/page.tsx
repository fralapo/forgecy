import { Card } from "@forgecy/ui";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { UsageBar } from "../_components/usage-bar";
import { WriteTest } from "./write-test";
import { diskSpace, localUsage, mediaRoot, type StorageUsage } from "./usage";

export async function generateMetadata() {
  const t = await getTranslations("admin.storage");
  return { title: t("title") };
}

/** Below this share of free space the disk counts as almost full. */
const LOW_SPACE_PERCENT = 10;

export default async function StoragePage() {
  const user = await requireUser();
  const t = await getTranslations("admin.storage");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const te = await getTranslations("enums");
  const format = await getFormat();
  const local = env.STORAGE_DRIVER === "local";
  const root = mediaRoot();
  const [space, usage] = await Promise.all([
    diskSpace(local ? root : process.cwd()),
    local ? localUsage() : Promise.resolve<StorageUsage | null>(null),
  ]);
  const bytes = (n: number) =>
    n >= 1e9
      ? t("size.gb", { value: format.number(n / 1e9, { maximumFractionDigits: 1 }) })
      : n >= 1e6
        ? t("size.mb", { value: format.number(n / 1e6, { maximumFractionDigits: 1 }) })
        : t("size.kb", { value: format.number(Math.ceil(n / 1e3)) });
  const usedPercent = space ? ((space.totalBytes - space.freeBytes) / space.totalBytes) * 100 : 0;
  const lowSpace = space ? (space.freeBytes / space.totalBytes) * 100 < LOW_SPACE_PERCENT : false;

  const rows: [string, string][] = local
    ? [
        [t("config.driver"), te("storageDriver.local")],
        [t("config.path"), root],
      ]
    : [
        [t("config.driver"), te("storageDriver.s3")],
        [t("config.endpoint"), env.S3_ENDPOINT ?? t("config.awsDefault")],
        [t("config.bucket"), env.S3_BUCKET],
        [t("config.region"), env.S3_REGION],
        [t("config.accessKey"), t(env.S3_ACCESS_KEY_ID ? "config.set" : "config.notSet")],
        [
          t("config.pathStyle"),
          t(env.S3_FORCE_PATH_STYLE || env.S3_ENDPOINT ? "config.yes" : "config.no"),
        ],
      ];

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      {lowSpace ? (
        <p role="alert" className="mb-6 rounded-md bg-warning-fill p-4 text-body-sm text-fg">
          {t("lowSpace", { percent: LOW_SPACE_PERCENT })}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("config.title")}</h2>
          <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-y-2 text-body-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-fg-muted">{label}</dt>
                <dd className="break-all font-mono text-fg">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-body-sm text-fg-muted">{t("config.envHint")}</p>
          <WriteTest />
        </Card>
        <Card className="p-6">
          <h2 className="text-heading-sm text-fg">{t("space.title")}</h2>
          {space ? (
            <div className="mt-4 flex flex-col gap-2">
              <UsageBar
                percent={usedPercent}
                label={t("space.summary", {
                  free: bytes(space.freeBytes),
                  total: bytes(space.totalBytes),
                })}
              />
              <p className="text-body-sm text-fg">
                {t("space.summary", {
                  free: bytes(space.freeBytes),
                  total: bytes(space.totalBytes),
                })}
              </p>
              {!local ? <p className="text-body-sm text-fg-muted">{t("space.s3Note")}</p> : null}
            </div>
          ) : (
            <p className="mt-4 text-body-sm text-fg-muted">{t("space.unknown")}</p>
          )}
          {usage ? (
            <>
              <h3 className="mt-6 text-body-md font-semibold text-fg">{t("usage.title")}</h3>
              {usage.byArea.length === 0 ? (
                <p className="mt-2 text-body-sm text-fg-muted">{t("usage.empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="mt-2 w-full text-left text-body-sm">
                    <thead className="text-fg-muted">
                      <tr className="border-b border-subtle">
                        <th scope="col" className="py-2 font-normal">
                          {t("usage.area")}
                        </th>
                        <th scope="col" className="py-2 text-right font-normal">
                          {t("usage.files")}
                        </th>
                        <th scope="col" className="py-2 text-right font-normal">
                          {t("usage.size")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {usage.byArea.map((a) => (
                        <tr key={a.area}>
                          <td className="py-2 font-mono text-fg">{a.area}</td>
                          <td className="py-2 text-right text-fg">{format.number(a.files)}</td>
                          <td className="py-2 text-right text-fg">{bytes(a.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-body-sm text-fg">
                {t("usage.backups", { size: bytes(usage.backupsBytes) })}
              </p>
              {usage.truncated ? (
                <p className="mt-1 text-body-sm text-fg-muted">{t("usage.truncated")}</p>
              ) : null}
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
