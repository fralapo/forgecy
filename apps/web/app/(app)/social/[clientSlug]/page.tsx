import {
  createSocialRuntime,
  hasActiveSnapshotJob,
  listClientProfiles,
  loadBenchmark,
  sourceStatus,
} from "@forgecy/social";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { RefreshWhile } from "../../content/_components/refresh-while";
import { SOCIAL_TIME_ZONE, loadSocialClient } from "../_lib/server";
import { AddProfileForm } from "../_components/add-profile-form";
import { BenchmarkCard } from "../_components/benchmark-table";
import { ProfileList } from "../_components/profile-list";
import { SourceBanner } from "../_components/source-banner";

export async function generateMetadata() {
  const t = await getTranslations("social");
  return { title: t("title") };
}

export default async function SocialClientPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const t = await getTranslations("social");
  const { db, user, client, canEdit, isAdmin } = await loadSocialClient(clientSlug);

  const [items, status] = await Promise.all([
    listClientProfiles(db, user.actor, client.id),
    sourceStatus(db, createSocialRuntime(env)),
  ]);
  const reading = new Set(
    (
      await Promise.all(
        items.map(async (i) =>
          (await hasActiveSnapshotJob(db, i.profile.id)) ? i.profile.id : null,
        ),
      )
    ).filter((id): id is string => id !== null),
  );
  // The comparison needs at least two profiles that were read.
  const benchmark =
    items.filter((i) => i.snapshot).length >= 2
      ? await loadBenchmark(db, user.actor, client.id, { timeZone: SOCIAL_TIME_ZONE })
      : null;
  const defaultRole = items.some((i) => i.profile.role === "self") ? "competitor" : "self";

  return (
    <>
      <p className="mb-2 text-body-sm text-fg-muted">
        <Link href={"/social" as Route}>{t("title")}</Link> › {client.name}
      </p>
      <PageHeader
        title={t("home.heading", { client: client.name })}
        description={t("home.description")}
      />
      <RefreshWhile active={reading.size > 0} />
      <SourceBanner slug={client.slug} status={status} isAdmin={isAdmin} />
      {canEdit ? <AddProfileForm slug={client.slug} defaultRole={defaultRole} /> : null}
      <ProfileList slug={client.slug} items={items} reading={reading} canEdit={canEdit} />
      {benchmark && benchmark.rows.length >= 2 ? (
        <BenchmarkCard slug={client.slug} table={benchmark} />
      ) : null}
    </>
  );
}
