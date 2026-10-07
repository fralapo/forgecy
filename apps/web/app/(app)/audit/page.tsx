import { listProspects } from "@forgecy/audit";
import { auditStatuses, type AuditStatus } from "@forgecy/core";
import { Badge, Button, Card, Input } from "@forgecy/ui";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { auditStatusVariant } from "./_lib/labels";
import { readDeps } from "./_lib/server";
import { selectClass } from "./_lib/styles";

export async function generateMetadata() {
  const t = await getTranslations("audit.list");
  return { title: t("title") };
}

export default async function AuditListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; archived?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const status =
    sp.status === "none" || auditStatuses.includes(sp.status as AuditStatus)
      ? (sp.status as AuditStatus | "none")
      : undefined;
  const archived = sp.archived === "1";
  const rows = await listProspects(readDeps().db, {
    ...(sp.q ? { q: sp.q } : {}),
    ...(status ? { status } : {}),
    archived,
  });
  const t = await getTranslations("audit");
  const format = await getFormat();
  return (
    <>
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <Button asChild>
            <Link href="/audit/new">
              <Plus aria-hidden />
              {t("list.newProspect")}
            </Link>
          </Button>
        }
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-label text-fg-muted">
          {t("list.search")}
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("list.searchPlaceholder")} />
        </label>
        <label className="flex w-56 flex-col gap-1 text-label text-fg-muted">
          {t("list.auditStatus")}
          <select name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">{t("list.all")}</option>
            <option value="none">{t("list.notStartedOption")}</option>
            {auditStatuses
              .filter((s) => s !== "archived" && s !== "draft")
              .map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-body-sm text-fg">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          {t("list.archived")}
        </label>
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          {t("list.filter")}
        </Button>
      </form>
      <Card className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-body-md text-fg-muted">
              {sp.q || status || archived ? t("list.noMatches") : t("list.empty")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <caption className="sr-only">{t("list.caption")}</caption>
              <thead className="border-b border-subtle text-label text-fg-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.prospect")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.sectorArea")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.audit")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.toReview")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.owner")}
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    {t("list.columns.updated")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-subtle last:border-0">
                    <td className="px-6 py-3">
                      <Link
                        href={`/audit/${r.slug}`}
                        className="font-medium text-link underline-offset-2 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.websiteUrl ? (
                        <span className="block text-fg-muted">{r.websiteUrl}</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-fg-muted">
                      {[r.sector, r.area].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-6 py-3">
                      {r.auditStatus ? (
                        <Badge variant={auditStatusVariant[r.auditStatus]}>
                          {t(`status.${r.auditStatus}`)}
                        </Badge>
                      ) : (
                        <span className="text-fg-muted">{t("list.notStarted")}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-fg">{r.toReview || "—"}</td>
                    <td className="px-6 py-3 text-fg-muted">{r.ownerName ?? "—"}</td>
                    <td className="px-6 py-3 text-fg-muted">{format.date(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
