import { getPublishedBrandIdentity } from "@forgecy/brand";
import { contentStatusLabels } from "@forgecy/content";
import { and, brandIdentityVersions, eq } from "@forgecy/db";
import { Badge } from "@forgecy/ui";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { CarouselTabs } from "../../../_components/carousel-tabs";
import { RefreshWhile } from "../../../_components/refresh-while";
import { carouselPath, carouselsPath, formatDate } from "../../../_lib/paths";
import { jobLabel, statusVariant } from "../_lib/labels";
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
  const attention = [...latestByKind.values()].filter(
    (j) => j.status === "failed" || j.status === "needs_attention",
  );

  const base = carouselPath(client.slug, c.id);
  const tabs = [
    { href: base, label: "Brief" },
    { href: `${base}/outline`, label: "Outline" },
    { href: `${base}/editor`, label: "Editor" },
    { href: `${base}/review`, label: "Review" },
    { href: `${base}/export`, label: "Export" },
    { href: `${base}/versions`, label: "Versions" },
  ];

  return (
    <>
      <RefreshWhile active={active.length > 0 || ws.locked} />
      <header className="mb-4">
        <p className="text-body-sm text-fg-muted">
          <Link href={carouselsPath(client.slug) as Route}>Carousels</Link> › {c.title}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-heading-md text-fg">{c.title}</h2>
          <Badge variant={statusVariant[c.status]}>{contentStatusLabels[c.status]}</Badge>
          <Badge>
            {ws.template
              ? `${ws.template.name} · v${ws.template.version}`
              : `Template ${c.templateKey} unavailable`}
          </Badge>
          {usedBrand ? <Badge>Brand Identity v{usedBrand.number}</Badge> : null}
          {ws.locked ? <Badge variant="highlight">AI at work</Badge> : null}
        </div>
        {productChanged || productMissing || brandChanged ? (
          <ul className="mt-3 grid gap-1">
            {productChanged ? (
              <li>
                <Badge variant="warning">
                  The product changed in the catalog after the copy was written
                </Badge>
              </li>
            ) : null}
            {productMissing ? (
              <li>
                <Badge variant="warning">The linked product is no longer approved</Badge>
              </li>
            ) : null}
            {brandChanged && brand ? (
              <li>
                <Badge variant="warning">
                  Brand Identity v{brand.number} was published after the carousel was created
                </Badge>
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
              {jobLabel(j.kind)}: {j.status === "queued" ? "queued" : "in progress"}
              {j.progress > 0 ? ` · ${j.progress}%` : ""}
              <progress
                className="ml-auto h-2 w-32"
                max={100}
                value={j.progress}
                aria-label={`Progress: ${jobLabel(j.kind)}`}
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
                  {jobLabel(j.kind)} {j.status === "needs_attention" ? "needs attention" : "failed"}
                </strong>{" "}
                ({formatDate(j.endedAt ?? j.createdAt)})
                {j.error ? <span className="block text-fg-muted">{j.error}</span> : null}
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
