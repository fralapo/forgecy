import { channelLabels, getNewCarouselOptions, getPlanItem } from "@forgecy/content";
import { Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { CarouselNewForm, type PlanSeed } from "../../../_components/carousel-new-form";
import { carouselPath, carouselsPath } from "../../../_lib/paths";
import { loadClient } from "../../../_lib/server";

export async function generateMetadata() {
  const t = await getTranslations("content.newCarousel");
  return { title: t("metaTitle") };
}

export default async function NewCarouselPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const { db, user, client } = await loadClient(clientSlug);
  const t = await getTranslations("content.newCarousel");
  const planId = typeof sp.plan === "string" ? sp.plan : null;
  const [options, item] = await Promise.all([
    getNewCarouselOptions(db, user.actor, client.id),
    planId ? getPlanItem(db, user.actor, client.id, planId) : null,
  ]);
  const plan: PlanSeed | null =
    item && item.status === "accepted" && !item.contentId
      ? {
          id: item.id,
          title: item.theme,
          channel: item.channel as PlanSeed["channel"],
          format: item.format,
          pillarId: item.pillarId,
          rubricId: item.rubricId,
          productId: item.productIds[0] ?? null,
          briefText: [item.theme, item.hook, item.notes].filter(Boolean).join("\n"),
        }
      : null;

  return (
    <Card className="p-6">
      <h2 className="mb-1 text-heading-md text-fg">{t("title")}</h2>
      <p className="mb-6 text-body-sm text-fg-muted">
        <Link href={carouselsPath(client.slug) as Route}>{t("back")}</Link>
      </p>
      {item && item.contentId ? (
        <p role="status" className="mb-4 text-body-sm text-fg">
          {t("exists")}{" "}
          <Link href={carouselPath(client.slug, item.contentId) as Route}>{t("openIt")}</Link>
        </p>
      ) : null}
      {plan ? (
        <p role="status" className="mb-4 text-body-sm text-fg">
          {t("fromPlan", {
            day: item?.day ?? "",
            channel: channelLabels[plan.channel] ?? plan.channel,
          })}
        </p>
      ) : null}
      {!options.brandPublished ? (
        <p role="alert" className="mb-4 text-body-sm text-fg">
          {t("brandRequired")} <Link href={`/brand/${client.slug}` as Route}>{t("openBrand")}</Link>
        </p>
      ) : options.templates.length === 0 ? (
        <p role="alert" className="mb-4 text-body-sm text-fg">
          {t("noTemplates")}
        </p>
      ) : null}
      <CarouselNewForm slug={client.slug} clientId={client.id} options={options} plan={plan} />
    </Card>
  );
}
