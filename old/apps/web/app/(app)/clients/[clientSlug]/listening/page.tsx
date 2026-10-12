import { can, listeningStatuses, type ListeningStatus } from "@forgecy/core";
import { listSignals, listSignalTags } from "@forgecy/social";
import { Button, Card, Label } from "@forgecy/ui";
import { ArrowLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { controlClass } from "../../../content/_components/action-button";
import { loadClientPage } from "../../_lib/server";
import { SignalForm, SignalRow } from "./signal-views";

export async function generateMetadata() {
  const t = await getTranslations("clients.listening");
  return { title: t("metaTitle") };
}

export default async function ClientListeningPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client } = await loadClientPage(clientSlug);
  const t = await getTranslations("clients.listening");
  const format = await getFormat();
  const tag = typeof sp.tag === "string" && sp.tag ? sp.tag : undefined;
  const status = listeningStatuses.find((s) => s === sp.status) as ListeningStatus | undefined;
  const [signals, tags] = await Promise.all([
    listSignals(db, user.actor, client.id, {
      ...(tag ? { tag } : {}),
      ...(status ? { status } : {}),
    }),
    listSignalTags(db, user.actor, client.id),
  ]);
  const canWrite = can(user.actor, "project.edit", client.id);
  const base = `/clients/${client.slug}/listening`;
  const filtered = Boolean(tag || status);

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
      {canWrite ? (
        <Card className="mb-6 space-y-4 p-5">
          <h2 className="text-heading-sm text-fg">{t("form.add")}</h2>
          <SignalForm slug={client.slug} />
        </Card>
      ) : null}
      <form method="get" action={base} className="mb-6 flex flex-wrap items-end gap-4">
        <div className="w-48 space-y-2">
          <Label htmlFor="tag">{t("filters.tag")}</Label>
          <select id="tag" name="tag" defaultValue={tag ?? ""} className={controlClass}>
            <option value="">{t("filters.all")}</option>
            {tags.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48 space-y-2">
          <Label htmlFor="status">{t("filters.status")}</Label>
          <select id="status" name="status" defaultValue={status ?? ""} className={controlClass}>
            <option value="">{t("filters.all")}</option>
            {listeningStatuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
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
        {signals.length === 0 ? (
          <p className="text-body-md text-fg-muted">{filtered ? t("emptyFiltered") : t("empty")}</p>
        ) : (
          <>
            <p aria-live="polite" className="text-body-sm text-fg-muted">
              {t("shown", { count: signals.length })}
            </p>
            <ul className="divide-y divide-subtle">
              {signals.map((s) => (
                <SignalRow
                  key={s.id}
                  slug={client.slug}
                  canWrite={canWrite}
                  signal={{
                    id: s.id,
                    text: s.text,
                    platform: s.platform,
                    url: s.url,
                    day: s.occurredAt.toISOString().slice(0, 10),
                    when: format.date(s.occurredAt),
                    tag: s.tag,
                    status: s.status,
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
