import {
  brandImageClasses,
  type BrandCompleteness,
  type BrandImage,
  type BrandImageClass,
  type LatestAutoImport,
} from "@forgecy/brand";
import type { MessageRef } from "@forgecy/core";
import { Badge, Card, cn } from "@forgecy/ui";
import { ImageOff, LoaderCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getFormat, getRefText } from "@/lib/i18n";
import { RefreshWhile } from "../../content/_components/refresh-while";
import { importNotes } from "../_lib/import-card";
import { sourceStatusVariant } from "../_lib/labels";
import { crawlSourceAction, scanWebsiteAction } from "../actions";
import { ActionButton } from "./action-button";
import { UndoImportButton } from "./undo-import-button";

/** Percent and the nine sections of the profile, filled or not. */
export async function CompletenessCard({ completeness }: { completeness: BrandCompleteness }) {
  const t = await getTranslations("brand.overview");
  const format = await getFormat();
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading-sm text-fg">{t("completenessTitle")}</h2>
        <p className="text-body-sm text-fg-muted">
          {t("completenessValue", {
            percent: format.number(completeness.percent),
            filled: completeness.filled,
            total: completeness.total,
          })}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={t("completenessTitle")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={completeness.percent}
        className="h-2 overflow-hidden rounded-sm bg-app"
      >
        <div className="h-full bg-primary" style={{ width: `${completeness.percent}%` }} />
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
        {completeness.sections.map((s) => {
          const section = t(`section.${s.key}`);
          return (
            <li
              key={s.key}
              className={cn("flex items-center gap-2", s.filled ? "text-fg" : "text-fg-muted")}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full border",
                  s.filled ? "border-primary bg-primary" : "border-control",
                )}
              />
              <span className="sr-only">
                {s.filled ? t("sectionFilled", { section }) : t("sectionEmpty", { section })}
              </span>
              <span aria-hidden>{section}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Shown while the website or a profile is read: the page refreshes until the import ends. */
export async function ImportBanner() {
  const t = await getTranslations("brand.overview");
  return (
    <Card role="status" className="flex items-start gap-3 border-primary p-5">
      <RefreshWhile active />
      <LoaderCircle aria-hidden className="mt-1 size-5 shrink-0 animate-spin text-link" />
      <div className="space-y-1">
        <h2 className="text-heading-sm text-fg">{t("importRunningTitle")}</h2>
        <p className="text-body-sm text-fg-muted">{t("importRunning")}</p>
      </div>
    </Card>
  );
}

/** "Imported automatically on ..." with the way back: review what was kept, or undo. */
export async function ImportCard({
  slug,
  clientId,
  base,
  latest,
  canUndo,
}: {
  slug: string;
  clientId: string;
  base: string;
  latest: LatestAutoImport;
  canUndo: boolean;
}) {
  const t = await getTranslations("brand.overview");
  const format = await getFormat();
  const rt = await getRefText();
  const notes = importNotes(latest);
  // A person undid it: the card says so instead of describing what the import applied.
  if (notes.undone)
    return (
      <Card className="p-5">
        <p className="text-body-md text-fg">{rt(notes.undone, "")}</p>
      </Card>
    );
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="space-y-1">
        <p className="text-body-md text-fg">
          {t("importedLine", {
            date: format.date(latest.at, "dateTime"),
            accepted: latest.accepted,
          })}
          {notes.kept ? ` · ${rt(notes.kept, "")}` : ""}
        </p>
        {latest.skippedHandEdited ? (
          <p className="text-body-sm text-fg-muted">
            {t("importedEdits", { count: latest.skippedHandEdited })}
          </p>
        ) : null}
        {latest.needsReview ? (
          <Link href={`${base}/proposals` as Route} className="text-body-sm">
            {t("importedReview")}
          </Link>
        ) : null}
        {!latest.current ? (
          <p className="text-body-sm text-fg-muted">{t("importedReplaced")}</p>
        ) : null}
      </div>
      {latest.current && latest.previous && canUndo ? (
        <UndoImportButton slug={slug} clientId={clientId} versionId={latest.versionId} />
      ) : null}
    </Card>
  );
}

/** Status of the website analysis and the button that runs it again. */
export async function WebsiteCard({
  slug,
  clientId,
  websiteUrl,
  source,
  canEdit,
}: {
  slug: string;
  clientId: string;
  websiteUrl: string | null;
  source: {
    id: string;
    title: string;
    status: "pending" | "extracting" | "extracted" | "partial" | "failed";
    statusDetail: string | null;
    statusDetailRef: MessageRef[] | null;
  } | null;
  canEdit: boolean;
}) {
  const t = await getTranslations("brand");
  const rt = await getRefText();
  if (!source && !websiteUrl) return null;
  const running = source?.status === "pending" || source?.status === "extracting";
  return (
    <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
      <RefreshWhile active={running} />
      <div className="space-y-1">
        <h2 className="text-heading-sm text-fg">{t("overview.analysisTitle")}</h2>
        <p className="text-body-sm text-fg-muted">{source?.title ?? websiteUrl}</p>
        {source ? (
          <p className="flex flex-wrap items-center gap-2 text-body-sm">
            <Badge variant={sourceStatusVariant[source.status]}>
              {t(`sourceStatus.${source.status}`)}
            </Badge>
            <span className="text-fg-muted">
              {running
                ? t("overview.analysisRunning")
                : source.statusDetailRef?.length
                  ? source.statusDetailRef.map((r) => rt(r, "")).join(" · ")
                  : source.statusDetail}
            </span>
          </p>
        ) : (
          <p className="text-body-sm text-fg-muted">{t("overview.analysisNone")}</p>
        )}
      </div>
      {canEdit ? (
        source ? (
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={running}
            action={crawlSourceAction.bind(null, { slug, clientId, sourceId: source.id })}
          >
            {t("overview.reanalyze")}
          </ActionButton>
        ) : (
          <ActionButton
            variant="secondary"
            size="sm"
            action={scanWebsiteAction.bind(null, { slug, clientId, websiteUrl: websiteUrl! })}
          >
            {t("overview.analysisStart", { site: websiteUrl! })}
          </ActionButton>
        )
      ) : null}
    </Card>
  );
}

/** Read-only grid of the pictures taken from the site and profiles, filtered by class. */
export async function ImagesCard({
  base,
  libraryHref,
  images,
  urls,
  filter,
}: {
  base: string;
  libraryHref: string;
  images: BrandImage[];
  urls: Map<string, string>;
  filter: BrandImageClass | undefined;
}) {
  const t = await getTranslations("brand.overview");
  const shown = filter ? images.filter((i) => i.class === filter) : images;
  const chip = (active: boolean) =>
    cn(
      "rounded-sm border px-3 py-1 text-body-sm",
      active ? "border-primary text-link" : "border-subtle text-fg",
    );
  return (
    <Card className="space-y-4 p-5">
      <div className="space-y-1">
        <h2 className="text-heading-sm text-fg">{t("imagesTitle")}</h2>
        <p className="text-body-sm text-fg-muted">{t("imagesIntro")}</p>
      </div>
      {images.length ? (
        <nav aria-label={t("imagesFilterLabel")} className="flex flex-wrap gap-2">
          <Link href={base as Route} className={chip(!filter)}>
            {t("imagesAll")}
          </Link>
          {brandImageClasses.map((c) => (
            <Link key={c} href={`${base}?images=${c}` as Route} className={chip(filter === c)}>
              {t(`imageClass.${c}`)}
            </Link>
          ))}
        </nav>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-body-sm text-fg-muted">
          {images.length ? t("imagesEmptyFiltered") : t("imagesEmpty")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {shown.map((i) => {
            const url = urls.get(i.storageKey);
            return (
              <li key={i.id} className="space-y-2">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                  <img
                    src={url}
                    alt={i.alt}
                    loading="lazy"
                    className="aspect-square w-full rounded-md border border-subtle bg-app object-contain"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-subtle text-fg-muted">
                    <ImageOff aria-hidden />
                    <span className="sr-only">{t("imagesNoPreview")}</span>
                  </div>
                )}
                {i.alt ? <p className="line-clamp-2 text-body-sm text-fg-muted">{i.alt}</p> : null}
                <div className="flex flex-wrap gap-1">
                  <Badge>{i.class ? t(`imageClass.${i.class}`) : t("imagesProfile")}</Badge>
                  {i.status === "draft" ? (
                    <Badge variant="warning">{t("imagesDraft")}</Badge>
                  ) : null}
                </div>
                {i.status === "draft" && i.rightsPending ? (
                  <Link href={libraryHref as Route} className="block text-body-sm">
                    {t("imagesRightsPending")}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
