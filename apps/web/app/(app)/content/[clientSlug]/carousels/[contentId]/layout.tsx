import { getPublishedBrandIdentity } from "@forgecy/brand";
import { and, brandIdentityVersions, eq } from "@forgecy/db";
import { Badge } from "@forgecy/ui";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getFormat, refText } from "@/lib/i18n";
import { CarouselTabs } from "../../../_components/carousel-tabs";
import { RefreshWhile } from "../../../_components/refresh-while";
import { carouselPath, carouselsPath } from "../../../_lib/paths";
import { jobKey, statusVariant } from "../_lib/labels";
import { isActiveJob, loadCarousel } from "../_lib/workspace";

export default async function CarouselLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { db, user, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const t = await getTranslations("content.carousel");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const jobLabel = (kind: string) => tl(`job.${jobKey(kind)}`);
  const [brand, usedBrand] = await Promise.all([
    getPublishedBrandIdentity(db, user.actor, client.id),
    c.brandVersionId
      ? db
          .select({ number: brandIdentityVersions.number })
          .from(brandIdentityVersions)
          .where(
            and(
              eq(brandIdentityVersions.id, c.brandVersionId),
              eq(brandIdentityVersions.clientId, client.id),
            ),
          )
          .then((r) => r[0] ?? null)
      : null,
  ]);
  const productChanged =
    c.productId !== null &&
    c.productRevision !== null &&
    ws.product !== null &&
    ws.product.revision > c.productRevision;
  const productMissing = c.productId !== null && ws.product === null;
  const brandChanged = Boolean(c.brandVersionId && brand && brand.versionId !== c.brandVersionId);

  // Running jobs drive the refresh; for each kind only the latest run speaks.
  const active = ws.jobs.filter((j) => isActiveJob(j.status));
  const latestByKind = new Map<string, (typeof ws.jobs)[number]>();
  for (const j of ws.jobs) if (!latestByKind.has(j.kind)) latestByKind.set(j.kind, j);
  const attention = await Promise.all(
    [...latestByKind.values()]
      .filter((j) => j.status === "failed" || j.status === "needs_attention")
      .map(async (j) => ({ ...j, errorText: j.error ? await refText(j.errorRef, j.error) : null })),
  );

  const base = carouselPath(client.slug, c.id);
  const tabs = [
    { href: base, label: t("tabs.brief") },
    { href: `${base}/outline`, label: t("tabs.outline") },
    { href: `${base}/editor`, label: t("tabs.editor") },
    { href: `${base}/review`, label: t("tabs.review") },
    { href: `${base}/export`, label: t("tabs.export") },
    { href: `${base}/versions`, label: t("tabs.versions") },
  ];

  return (
    <>
      <RefreshWhile active={active.length > 0 || ws.locked} />
      <header className="mb-4">
        <p className="text-body-sm text-fg-muted">
          <Link href={carouselsPath(client.slug) as Route}>{t("breadcrumb")}</Link> › {c.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-heading-md text-fg">{c.title}</h2>
          <Badge variant={statusVariant[c.status]}>{tl(`contentStatus.${c.status}`)}</Badge>
          <Badge>
            {ws.template
              ? tl("templateVersion", { name: ws.template.name, version: ws.template.version })
              : t("templateUnavailable", { key: c.templateKey })}
          </Badge>
          {usedBrand ? <Badge>{t("brandVersion", { number: usedBrand.number })}</Badge> : null}
          {ws.locked ? <Badge variant="highlight">{t("aiAtWork")}</Badge> : null}
        </div>
        {productChanged || productMissing || brandChanged ? (
          <ul className="mt-3 grid gap-1">
            {productChanged ? (
              <li>
                <Badge variant="warning">{t("productChanged")}</Badge>
              </li>
            ) : null}
            {productMissing ? (
              <li>
                <Badge variant="warning">{t("productMissing")}</Badge>
              </li>
            ) : null}
            {brandChanged && brand ? (
              <li>
                <Badge variant="warning">{t("brandChanged", { number: brand.number })}</Badge>
              </li>
            ) : null}
          </ul>
        ) : null}
      </header>
      {active.length || attention.length ? (
        <ul className="mb-4 grid gap-2" aria-live="polite">
          {active.map((j) => (
            <li
              key={j.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-subtle bg-surface px-4 py-2 text-body-sm text-fg"
            >
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {j.status === "queued"
                ? t("job.queued", { job: jobLabel(j.kind) })
                : t("job.running", { job: jobLabel(j.kind) })}
              {j.progress > 0 ? ` · ${format.percent(j.progress / 100)}` : ""}
              <progress
                className="ml-auto h-2 w-32"
                max={100}
                value={j.progress}
                aria-label={t("job.progress", { job: jobLabel(j.kind) })}
              />
            </li>
          ))}
          {attention.map((j) => (
            <li
              key={j.id}
              role="alert"
              className="flex flex-wrap items-start gap-2 rounded-md border border-error-fill bg-surface px-4 py-2 text-body-sm text-fg"
            >
              <CircleAlert aria-hidden className="size-4 text-error" />
              <span>
                <strong className="font-medium">
                  {j.status === "needs_attention"
                    ? t("job.needsAttention", { job: jobLabel(j.kind) })
                    : t("job.failed", { job: jobLabel(j.kind) })}
                </strong>{" "}
                ({format.date(j.endedAt ?? j.createdAt, "dateTime")})
                {j.errorText ? <span className="block text-fg-muted">{j.errorText}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <CarouselTabs tabs={tabs} />
      {children}
    </>
  );
}
