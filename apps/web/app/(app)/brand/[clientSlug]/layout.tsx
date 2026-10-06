import { Badge } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ActionButton } from "../_components/action-button";
import { BrandTabs } from "../_components/brand-tabs";
import { startDraftAction, submitAction } from "../actions";
import { brandPath, versionStatusVariant } from "../_lib/labels";
import { loadBrand, openConflicts, userNames } from "../_lib/server";
import { getFormat } from "@/lib/i18n";

export default async function BrandLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const t = await getTranslations("brand");
  const format = await getFormat();
  const { client, ws } = await loadBrand(clientSlug);
  const conflicts = await openConflicts(client.id);
  const { draft, published } = ws;
  const names = await userNames([draft?.lastEditedBy, draft?.createdBy]);
  const base = brandPath(client.slug);
  const tabs = [
    { href: base, label: t("tabs.overview") },
    { href: `${base}/strategy`, label: t("tabs.strategy") },
    { href: `${base}/verbal`, label: t("tabs.verbal") },
    { href: `${base}/visual`, label: t("tabs.visual") },
    { href: `${base}/content`, label: t("tabs.content") },
    {
      href: `${base}/sources`,
      label: t("tabs.sources"),
      count: Object.values(ws.sourceCounts).reduce((a, b) => a + (b ?? 0), 0),
    },
    {
      href: `${base}/proposals`,
      label: t("tabs.proposals"),
      count: ws.proposalCounts.proposed ?? 0,
    },
    { href: `${base}/versions`, label: t("tabs.versions") },
  ];
  const editor = draft ? names.get(draft.lastEditedBy ?? draft.createdBy ?? "") : undefined;

  return (
    <>
      <header className="mb-6">
        <p className="text-body-sm text-fg-muted">
          <Link href="/brand">{t("title")}</Link> › {client.name}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-heading-lg text-fg">
            {t("layout.heading", { client: client.name })}
          </h1>
          {published ? (
            <Badge variant="success">{t("layout.published", { number: published.number })}</Badge>
          ) : (
            <Badge>{t("layout.noPublished")}</Badge>
          )}
        </div>
      </header>
      <BrandTabs tabs={tabs} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-subtle bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-body-sm">
          {draft ? (
            <>
              <Badge variant={versionStatusVariant[draft.status]}>
                {t("layout.draftBadge", {
                  number: draft.number,
                  status: t(`versionStatus.${draft.status}`),
                })}
              </Badge>
              <span className="text-fg-muted">
                {t("layout.lastEdited", {
                  editor: editor ?? "—",
                  date: format.date(draft.updatedAt, "dateTime"),
                })}
              </span>
            </>
          ) : (
            <span className="text-fg-muted">
              {published
                ? t("layout.noDraftPublished", { number: published.number })
                : t("layout.noDraft")}
            </span>
          )}
          {conflicts.length ? (
            <Badge variant="warning">
              {t("layout.openConflicts", { count: conflicts.length })}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!draft ? (
            <ActionButton
              action={startDraftAction.bind(null, client.slug, client.id)}
              variant="secondary"
            >
              {published
                ? t("layout.openDraft", { number: published.number + 1 })
                : t("layout.startDraft")}
            </ActionButton>
          ) : null}
          {draft?.status === "draft" ? (
            <ActionButton
              action={submitAction.bind(null, {
                slug: client.slug,
                clientId: client.id,
                versionId: draft.id,
                rev: draft.rev,
              })}
              variant="secondary"
            >
              {t("layout.submit")}
            </ActionButton>
          ) : null}
          {draft ? (
            <Link
              href={`${base}/versions/${draft.number}/approve` as Route}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-medium text-primary-foreground"
            >
              {t("layout.openApproval")}
            </Link>
          ) : null}
        </div>
      </div>
      {draft?.status === "in_review" ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-warning-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          {draft.reviewComment
            ? t("layout.inReviewWithComment", {
                number: draft.number,
                comment: draft.reviewComment,
              })
            : t("layout.inReview", { number: draft.number })}
        </p>
      ) : null}
      {draft?.status === "draft" && draft.reviewComment ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-subtle bg-surface px-4 py-3 text-body-sm text-fg"
        >
          {t("layout.sentBack", { comment: draft.reviewComment })}
        </p>
      ) : null}
      {!published ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg"
        >
          {t("layout.cannotGenerate", { client: client.name })}
        </p>
      ) : null}
      {children}
    </>
  );
}
