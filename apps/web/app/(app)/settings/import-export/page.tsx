import { estimateClientExport, listClientExports } from "@forgecy/client-transfer";
import { clientTransferAreas } from "@forgecy/core";
import { asc, clients, getDb } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import { Download, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { AdminOnly } from "../_components/admin-only";
import { RefreshWhileRunning } from "../backup/forms";
import { ExportForm } from "./export-form";

export async function generateMetadata() {
  const t = await getTranslations("clientTransfer");
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

const statusVariant = {
  queued: "neutral",
  running: "info",
  ready: "success",
  failed: "error",
} as const;

export default async function ImportExportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const t = await getTranslations("clientTransfer");
  if (!user.isAdmin) return <AdminOnly title={t("title")} />;
  const sp = await searchParams;
  const db = getDb();
  const format = await getFormat();
  const size = (bytes: number) =>
    bytes < 1024 * 1024
      ? format.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte" })
      : format.number(bytes / 1024 / 1024, {
          style: "unit",
          unit: "megabyte",
          maximumFractionDigits: 1,
        });

  const all = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .orderBy(asc(clients.name));
  const clientId =
    typeof sp.client === "string" && all.some((c) => c.id === sp.client) ? sp.client : "";
  const [estimate, recent] = await Promise.all([
    clientId ? estimateClientExport(db, user.actor, clientId) : null,
    listClientExports(db, user.actor),
  ]);
  const busy = recent.some((r) => r.export.status === "queued" || r.export.status === "running");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <RefreshWhileRunning active={busy} />
      <h2 className="mb-4 text-heading-sm text-fg">{t("tabs.export")}</h2>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6">
          <ExportForm clients={all} clientId={clientId} />
        </Card>
        <Card className="p-6">
          <h3 className="text-heading-sm text-fg">{t("summary.title")}</h3>
          {estimate ? (
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-body-sm">
              {clientTransferAreas.map((a) => (
                <div key={a} className="contents">
                  <dt className="text-fg-muted">{t(`export.areas.${a}`)}</dt>
                  <dd className="text-right text-fg">
                    {t("summary.rows", { count: estimate.rows[a] })}
                  </dd>
                </div>
              ))}
              <dt className="text-fg-muted">{t("summary.images")}</dt>
              <dd className="text-right text-fg">{size(estimate.imageBytes)}</dd>
            </dl>
          ) : (
            <p className="mt-4 text-body-sm text-fg-muted">{t("summary.pick")}</p>
          )}
          <p
            role="note"
            className="mt-6 flex items-start gap-2 rounded-md border border-subtle bg-app p-3 text-body-sm text-fg"
          >
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            {t("summary.warning")}
          </p>
        </Card>
      </div>

      <h2 className="mt-8 mb-2 text-heading-sm text-fg">{t("recent.title")}</h2>
      <p className="mb-4 text-body-sm text-fg-muted">{t("recent.linkHint")}</p>
      {sp.missing ? (
        <p role="alert" className="mb-4 text-body-sm text-error">
          {t("errors.notReady")}
        </p>
      ) : null}
      {recent.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("recent.empty")}</p>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
          <table className="w-full text-left text-body-sm">
            <thead className="border-b border-subtle text-label text-fg-muted">
              <tr>
                {(["date", "client", "contents", "size", "statusColumn", "createdBy"] as const).map(
                  (c) => (
                    <th key={c} scope="col" className="px-4 py-3 font-medium">
                      {t(`recent.${c}`)}
                    </th>
                  ),
                )}
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">{t("recent.download")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ export: e, createdByName }) => (
                <tr key={e.id} className="border-b border-subtle align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-fg">
                    {format.date(e.createdAt, "dateTime")}
                  </td>
                  <td className="px-4 py-3 text-fg">{e.clientName}</td>
                  <td className="px-4 py-3 text-fg-muted">
                    {format.list(e.areas.map((a) => t(`export.areas.${a}`)))}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-fg">
                    {e.bytes ? size(e.bytes) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[e.status]}>
                      {t(`recent.status.${e.status}`)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {createdByName ?? t("recent.unknown")}
                  </td>
                  <td className="px-4 py-3">
                    {e.status === "ready" ? (
                      // A plain link: the route answers with a redirect to the file.
                      <a
                        href={`/settings/import-export/download/${e.id}`}
                        className="inline-flex items-center gap-1 text-link"
                      >
                        <Download aria-hidden className="size-4" />
                        {t("recent.download")}
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
