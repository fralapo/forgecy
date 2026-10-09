import {
  brandCompleteness,
  brandImageClasses,
  completeness,
  diffVersions,
  latestAutoImport,
  listBrandImages,
  parseDocument,
  publishChecks,
  referenceColors,
  type TokenTree,
} from "@forgecy/brand";
import { can } from "@forgecy/core";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import {
  CompletenessCard,
  ImagesCard,
  ImportBanner,
  ImportCard,
  WebsiteCard,
} from "../_components/overview-panels";
import { brandPath } from "../_lib/labels";
import {
  imageUrls,
  importRunning,
  loadBrand,
  openConflicts,
  shownVersion,
  sourcesFor,
} from "../_lib/server";
import { libraryPath } from "../../content/_lib/paths";
import { getFormat, refText } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getTranslations("brand");
  return { title: t("title") };
}

const blockPage = {
  strategy: "strategy",
  verbal: "verbal",
  visual: "visual",
  content: "content",
  presence: "strategy",
} as const;

export default async function BrandOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clientSlug }, sp] = await Promise.all([params, searchParams]);
  const t = await getTranslations("brand");
  const format = await getFormat();
  const { db, user, client, ws } = await loadBrand(clientSlug);
  const shown = shownVersion(ws);
  const [conflicts, allSources] = await Promise.all([
    openConflicts(client.id),
    sourcesFor(client.id),
  ]);
  // While the site or a profile is read, the proposals are about to apply themselves: no nudges.
  const importing = importRunning(allSources);
  const firstImport = importing && !ws.published;
  const base = brandPath(client.slug);
  const pending = ws.proposalCounts.proposed ?? 0;
  const sources = Object.values(ws.sourceCounts).reduce((a, b) => a + (b ?? 0), 0);
  const empty = !ws.versions.length && !sources && !pending;

  const publishedState = ws.published
    ? { document: parseDocument(ws.published.document), tokens: ws.published.tokens as TokenTree }
    : null;
  const draftChanges = ws.draft
    ? diffVersions(publishedState, { document: shown.document, tokens: shown.tokens })
    : [];
  const missing = new Map(
    await Promise.all(
      completeness(shown.document, shown.tokens).map(
        async (c) =>
          [
            c.block,
            await Promise.all(c.missingRefs.map((r, i) => refText(r, c.missing[i]!))),
          ] as const,
      ),
    ),
  );
  const checks = await Promise.all(
    publishChecks(shown.document, shown.tokens, {
      publishedTokens: publishedState?.tokens ?? null,
      conflicts: conflicts.length,
    }).map(async (c) => ({ key: c.key, message: await refText(c.ref, c.message) })),
  );

  // The same open points the block cards list ("Missing: ..."), so the two never disagree.
  const openBlock = (["strategy", "verbal", "visual", "content"] as const).find(
    (b) => missing.get(b)?.length,
  );
  const openPoints = [...missing.values()].reduce((n, m) => n + m.length, 0);
  const next = pending
    ? { label: t("overview.reviewProposals", { count: pending }), href: `${base}/proposals` }
    : conflicts.length
      ? {
          label: t("overview.resolveConflicts", { count: conflicts.length }),
          href: `${base}/proposals?conflicts=1`,
        }
      : ws.draft
        ? {
            label: t("overview.approveAndPublish", { number: ws.draft.number }),
            href: `${base}/versions/${ws.draft.number}/approve`,
          }
        : ws.published && openBlock
          ? {
              label: t("overview.completeOpenPoints", { count: openPoints }),
              href: `${base}/${blockPage[openBlock]}`,
            }
          : null;
  const publishedOn = (d: Date | null) => (d ? format.date(d, "dateTime") : "—");

  if (empty)
    return (
      <Card className="p-8">
        <h2 className="text-heading-md text-fg">
          {t("overview.emptyTitle", { client: client.name })}
        </h2>
        <p className="mt-2 text-body-md text-fg-muted">{t("overview.emptyHint")}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-medium text-primary-foreground"
            href={`${base}/sources?import=1` as Route}
          >
            {t("overview.importBrandBook")}
          </Link>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-control bg-surface px-4 text-body-sm text-fg"
            href={`${base}/sources` as Route}
          >
            {t("overview.addSource")}
          </Link>
          <Link
            className="inline-flex h-10 items-center rounded-md border border-control bg-surface px-4 text-body-sm text-fg"
            href={`${base}/strategy` as Route}
          >
            {t("overview.fillByHand")}
          </Link>
        </div>
      </Card>
    );

  const palette = referenceColors(shown.tokens).slice(0, 6);

  const [latest, images] = await Promise.all([
    latestAutoImport(db, user.actor, client.id),
    listBrandImages(db, user.actor, client.id),
  ]);
  const imageFilter = brandImageClasses.find((c) => c === sp.images);
  const urls = await imageUrls(
    client.id,
    images.map((i) => i.storageKey),
  );
  const website = allSources.find((s) => s.kind === "website") ?? null;
  const canEdit = can(user.actor, "edit_draft", client.id);
  // The same permissions the review, edit and publish buttons ask for.
  const canUndo = (["review", "edit_draft", "publish", "brand_identity.approve"] as const).every(
    (p) => can(user.actor, p, client.id),
  );

  return (
    <div className="space-y-6">
      {importing ? (
        <ImportBanner />
      ) : (
        <p className="text-body-md text-fg">
          <span className="text-fg-muted">{t("overview.nextAction")} </span>
          {next ? (
            <Link href={next.href as Route}>{next.label}</Link>
          ) : ws.published ? (
            t("overview.nothingPending", {
              number: ws.published.number,
              date: publishedOn(ws.published.publishedAt),
            })
          ) : (
            t("overview.fillAndPublish")
          )}
        </p>
      )}

      {firstImport ? null : (
        <CompletenessCard
          completeness={brandCompleteness(shown.document, shown.tokens, images.length)}
        />
      )}
      {latest ? (
        <ImportCard
          slug={client.slug}
          clientId={client.id}
          base={base}
          latest={latest}
          canUndo={canUndo}
        />
      ) : null}
      <WebsiteCard
        slug={client.slug}
        clientId={client.id}
        websiteUrl={client.websiteUrl}
        source={website}
        canEdit={canEdit}
      />

      <section aria-labelledby="pipeline" className="grid gap-3 md:grid-cols-4">
        <h2 id="pipeline" className="sr-only">
          {t("overview.statusHeading")}
        </h2>
        {[
          {
            label: t("overview.sources"),
            value: format.number(sources),
            detail: ws.sourceCounts.failed
              ? t("overview.sourcesFailed", { count: ws.sourceCounts.failed })
              : "",
            href: "sources",
          },
          {
            label: t("overview.pendingProposals"),
            value: format.number(pending),
            detail: t("overview.accepted", { count: ws.proposalCounts.accepted ?? 0 }),
            href: "proposals",
          },
          {
            label: t("overview.draft"),
            value: ws.draft ? t("overview.version", { number: ws.draft.number }) : "—",
            detail: ws.draft ? t("overview.draftChanges", { count: draftChanges.length }) : "",
            href: "versions",
          },
          {
            label: t("overview.published"),
            value: ws.published ? t("overview.version", { number: ws.published.number }) : "—",
            detail: ws.published ? publishedOn(ws.published.publishedAt) : "",
            href: "versions",
          },
        ].map((n) => (
          <Link
            key={n.label}
            href={`${base}/${n.href}` as Route}
            className="rounded-lg border border-subtle bg-surface p-4 text-fg hover:border-control"
          >
            <span className="block text-label text-fg-muted">{n.label}</span>
            <span className="block text-heading-md">{n.value}</span>
            {n.detail ? <span className="block text-body-sm text-fg-muted">{n.detail}</span> : null}
          </Link>
        ))}
      </section>

      {firstImport ? null : (
        <section aria-labelledby="blocks" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <h2 id="blocks" className="sr-only">
            {t("overview.blocksHeading")}
          </h2>
          {(["strategy", "verbal", "visual", "content"] as const).map((b) => {
            const m = missing.get(b) ?? [];
            const changes = draftChanges.filter((c) => c.block === b).length;
            return (
              <Card key={b} className="flex flex-col gap-3 p-5">
                <h3 className="text-heading-sm text-fg">{t(`blocks.${b}`)}</h3>
                {m.length ? (
                  <p className="text-body-sm text-fg-muted">
                    {t("overview.missing", { items: format.list([...m], "unit") })}
                  </p>
                ) : (
                  <Badge variant="success">{t("overview.complete")}</Badge>
                )}
                {changes ? (
                  <p className="text-body-sm text-fg">
                    {t("overview.changesInDraft", { count: changes })}
                  </p>
                ) : null}
                {b === "strategy" && shown.document.strategy.oneLiner ? (
                  <p className="text-body-sm text-fg">“{shown.document.strategy.oneLiner.value}”</p>
                ) : null}
                {b === "visual" && palette.length ? (
                  <ul className="flex gap-1" aria-label={t("overview.palette")}>
                    {palette.map((c) => (
                      <li
                        key={c.name}
                        title={`${c.name} ${c.hex}`}
                        className="size-6 rounded-sm border border-subtle"
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </ul>
                ) : null}
                <Link href={`${base}/${blockPage[b]}` as Route} className="mt-auto text-body-sm">
                  {t("overview.openBlock")}
                </Link>
              </Card>
            );
          })}
        </section>
      )}

      <ImagesCard
        base={base}
        libraryHref={libraryPath(client.slug)}
        images={images}
        urls={urls}
        filter={imageFilter}
      />

      {firstImport ? null : (
        <Card className="p-5">
          <h2 className="text-heading-sm text-fg">{t("overview.readyTitle")}</h2>
          {checks.length ? (
            <>
              <ul className="mt-3 space-y-1 text-body-sm text-fg">
                {checks.map((c) => (
                  <li key={c.key}>
                    <span className="text-warning">{t("overview.toConfirm")}</span> {c.message}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-body-sm text-fg-muted">{t("overview.canPublish")}</p>
            </>
          ) : (
            <p className="mt-3 text-body-sm text-success">{t("overview.noChecks")}</p>
          )}
        </Card>
      )}
    </div>
  );
}
