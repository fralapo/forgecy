import { Button, Card, Label } from "@forgecy/ui";
import { ArrowLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { ActivityList } from "../../_components/activity-list";
import {
  activityPeriods,
  activityQuery,
  actorKinds,
  filterAreas,
  PAGE_SIZE,
  parseActivityFilters,
} from "../../_lib/activity";
import { listClientActivity, loadClientPage } from "../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("clients.activity");
  return { title: t("metaTitle") };
}

const selectClass =
  "h-10 w-full rounded-md border border-control bg-surface px-3 text-body-sm text-fg focus-visible:outline-2 focus-visible:outline-focus";

export default async function ClientActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, client } = await loadClientPage(clientSlug);
  const t = await getTranslations("clients.activity");
  const filters = parseActivityFilters(sp);
  const { rows, total } = await listClientActivity(db, client.id, filters);
  const base = `/clients/${client.slug}/activity`;
  const filtered = Boolean(filters.actorType || filters.area || filters.period);

  return (
    <>
      <Link
        href={`/clients/${client.slug}` as Route}
        className="mb-4 inline-flex items-center gap-1 text-body-sm text-link underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("back", { client: client.name })}
      </Link>
      <PageHeader title={t("title", { client: client.name })} description={t("description")} />
      <form method="get" action={base} className="mb-6 flex flex-wrap items-end gap-4">
        <div className="w-48 space-y-2">
          <Label htmlFor="actorType">{t("filters.actorType")}</Label>
          <select
            id="actorType"
            name="actorType"
            defaultValue={filters.actorType ?? ""}
            className={selectClass}
          >
            <option value="">{t("filters.all")}</option>
            {actorKinds.map((k) => (
              <option key={k} value={k}>
                {t(`filters.actorTypes.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48 space-y-2">
          <Label htmlFor="area">{t("filters.area")}</Label>
          <select id="area" name="area" defaultValue={filters.area ?? ""} className={selectClass}>
            <option value="">{t("filters.all")}</option>
            {filterAreas.map((a) => (
              <option key={a} value={a}>
                {t(`areas.${a}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48 space-y-2">
          <Label htmlFor="period">{t("filters.period")}</Label>
          <select
            id="period"
            name="period"
            defaultValue={filters.period ?? ""}
            className={selectClass}
          >
            <option value="">{t("filters.anyTime")}</option>
            {activityPeriods.map((p) => (
              <option key={p} value={p}>
                {t(`filters.periods.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          {t("filters.apply")}
        </Button>
        {filtered ? (
          <Link
            href={base as Route}
            className="pb-2 text-body-sm text-link underline-offset-2 hover:underline"
          >
            {t("filters.reset")}
          </Link>
        ) : null}
      </form>
      <Card>
        {rows.length === 0 ? (
          <p className="text-body-md text-fg-muted">{filtered ? t("emptyFiltered") : t("empty")}</p>
        ) : (
          <>
            <p aria-live="polite" className="text-body-sm text-fg-muted">
              {t("shown", { shown: rows.length, total })}
            </p>
            <ActivityList rows={rows} clientSlug={client.slug} headingLevel="h2" />
            {rows.length < total ? (
              <Link
                href={
                  `${base}${activityQuery({ ...filters, limit: filters.limit + PAGE_SIZE })}` as Route
                }
                scroll={false}
                className="w-fit text-body-sm text-link underline-offset-2 hover:underline"
              >
                {t("loadMore", { count: Math.min(PAGE_SIZE, total - rows.length) })}
              </Link>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
