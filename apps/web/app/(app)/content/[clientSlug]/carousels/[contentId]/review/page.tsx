import { checkDocument, findingsToAcknowledge, imageKeys, parseDocument } from "@forgecy/content";
import { findLayout } from "@forgecy/carousel";
import { can } from "@forgecy/core";
import { and, contentVersions, eq } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { getFormat } from "@/lib/i18n";
import { SlideFrame } from "@/app/(app)/templates/slide-frame";
import { ReviewComments, type ReviewComment } from "../../../../_components/review-comments";
import { ReviewForm, type PendingImage } from "../../../../_components/review-form";
import { carouselPath } from "../../../../_lib/paths";
import { thumbnailUrls } from "../../../../_lib/server";
import { loadCarousel } from "../../_lib/workspace";

export async function generateMetadata() {
  const t = await getTranslations("content.review");
  return { title: t("metaTitle") };
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { db, user, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const t = await getTranslations("content.review");
  const tl = await getTranslations("content.labels");
  const format = await getFormat();
  const base = carouselPath(client.slug, c.id);
  const inReview = c.status === "in_review";

  const version = c.currentVersionId
    ? ((
        await db
          .select()
          .from(contentVersions)
          .where(
            and(eq(contentVersions.id, c.currentVersionId), eq(contentVersions.contentId, c.id)),
          )
      )[0] ?? null)
    : null;
  const doc = version ? parseDocument(version.document) : null;
  const result =
    inReview && version && doc?.slides.length
      ? await checkDocument(db, user.actor, c, doc, { guard: "read", version: version.number })
      : null;

  const usedKeys = new Set(doc ? imageKeys(doc) : []);
  const pendingAssets = ws.library.filter(
    (a) => usedKeys.has(a.storageKey) && a.status === "draft",
  );
  const thumbs = await thumbnailUrls(
    client.id,
    pendingAssets.map((a) => a.storageKey),
  );
  const pendingImages: PendingImage[] = pendingAssets.map((a) => {
    const g = (a.generation ?? {}) as { commercialUse?: string };
    return {
      id: a.id,
      alt: a.alt,
      thumb: thumbs.get(a.storageKey) ?? null,
      source: a.source,
      commercialUse:
        a.source !== "ai"
          ? null
          : g.commercialUse === "verified" || g.commercialUse === "rejected"
            ? g.commercialUse
            : "pending_verification",
    };
  });

  const guardReport = result?.guard ?? null;
  const toSee = findingsToAcknowledge(guardReport);
  const selfApproval = c.submittedBy === user.id || (!c.submittedBy && c.createdBy === user.id);
  const versionAuthor = ws.versions.find((v) => v.id === version?.id)?.authorName ?? null;
  const versionNumbers = new Map(ws.versions.map((v) => [v.id, v.number]));
  const comments = (slideId: string | null): ReviewComment[] =>
    ws.comments
      .filter((m) => m.slideId === slideId)
      .map((m) => ({
        id: m.id,
        body: m.body,
        authorName: m.authorName,
        createdAt: m.createdAt.toISOString(),
        resolvedAt: m.resolvedAt?.toISOString() ?? null,
      }));
  const ref = { slug: client.slug, clientId: client.id, contentId: c.id };
  const canComment = can(user.actor, "review", client.id);
  const manifest = ws.template?.manifest ?? null;
  const scale = manifest ? 280 / manifest.width : 1;

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-heading-md text-fg">
            {version ? t("version", { number: version.number }) : t("noVersion")}
          </h2>
          <Badge variant={inReview ? "warning" : "neutral"}>
            {tl(`contentStatus.${c.status}`)}
          </Badge>
        </div>
        {version ? (
          <p className="text-body-sm text-fg-muted">
            {versionAuthor
              ? t("createdBy", {
                  author: versionAuthor,
                  date: format.date(version.createdAt, "dateTime"),
                })
              : t("created", { date: format.date(version.createdAt, "dateTime") })}
          </p>
        ) : null}
        {!inReview ? (
          <p className="text-body-sm text-fg">
            {t("notInReview")}{" "}
            {c.status === "draft" || c.status === "changes_requested" ? (
              <Link href={`${base}/editor` as Route}>{t("openEditor")}</Link>
            ) : null}
          </p>
        ) : null}
        {c.reviewNote && c.status === "changes_requested" ? (
          <p className="whitespace-pre-line rounded-md border border-error-fill bg-surface px-4 py-3 text-body-sm text-fg">
            {c.reviewNote}
          </p>
        ) : null}
      </section>

      {version && doc && manifest ? (
        <section aria-labelledby="slides-title" className="space-y-4">
          <h2 id="slides-title" className="text-heading-sm text-fg">
            {t("slides")}
          </h2>
          <ol className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {doc.slides.map((s, i) => {
              const findings = (guardReport?.findings ?? []).filter(
                (f) => f.slide === i && f.status === "open" && f.severity !== "note",
              );
              return (
                <li key={s.id} className="space-y-3">
                  <SlideFrame
                    src={`${base}/preview?version=${version.id}&slide=${encodeURIComponent(s.id)}`}
                    title={t("slide", { number: i + 1 })}
                    width={manifest.width}
                    height={manifest.height}
                    scale={scale}
                  />
                  <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg">
                    {i + 1}. {findLayout(manifest, s.layout)?.name ?? s.layout}
                    {findings.length ? (
                      <Badge variant="warning">{t("findings", { count: findings.length })}</Badge>
                    ) : null}
                  </p>
                  {s.note ? (
                    <p className="text-body-sm text-fg-muted">{t("note", { note: s.note })}</p>
                  ) : null}
                  <ReviewComments
                    {...ref}
                    slideId={s.id}
                    label={t("commentTarget.slide", { number: i + 1 })}
                    comments={comments(s.id)}
                    canComment={canComment}
                  />
                </li>
              );
            })}
          </ol>
          <div className="space-y-2">
            <h3 className="text-label text-fg">{t("caption")}</h3>
            <p className="whitespace-pre-line text-body-sm text-fg">{doc.caption || "—"}</p>
            {doc.hashtags.length ? (
              <p className="text-body-sm text-fg-muted">{doc.hashtags.join(" ")}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <h3 className="text-label text-fg">{t("carouselComments")}</h3>
            <ReviewComments
              {...ref}
              slideId={null}
              label={t("commentTarget.carousel")}
              comments={comments(null)}
              canComment={canComment}
            />
          </div>
        </section>
      ) : null}

      {inReview && version && result ? (
        <Card className="p-6">
          <ReviewForm
            {...ref}
            versionId={version.id}
            versionNumber={version.number}
            canApprove={can(user.actor, "approve", client.id)}
            canReview={canComment}
            selfApproval={selfApproval}
            errors={result.errors}
            warnings={result.warnings}
            guard={
              guardReport
                ? {
                    band: guardReport.coherence.band,
                    findings: toSee,
                    notes: guardReport.findings.filter(
                      (f) => f.status === "open" && f.severity === "note",
                    ),
                    notRun: guardReport.notRun,
                  }
                : null
            }
            pendingImages={pendingImages}
          />
        </Card>
      ) : null}

      <section aria-labelledby="history-title" className="space-y-3">
        <h2 id="history-title" className="text-heading-sm text-fg">
          {t("history.title")}
        </h2>
        {ws.approvals.length ? (
          <ol className="space-y-3">
            {ws.approvals.map((a) => (
              <li key={a.id} className="space-y-1 rounded-md border border-subtle bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg">
                  <Badge variant={a.decision === "approved" ? "success" : "error"}>
                    {t(`history.decision.${a.decision}`)}
                  </Badge>
                  {t("history.version", { number: versionNumbers.get(a.versionId) ?? "—" })} ·{" "}
                  {a.deciderName ?? t("history.removedUser")} ·{" "}
                  {format.date(a.decidedAt, "dateTime")}
                  {a.selfApproval ? <Badge>{t("history.selfApproval")}</Badge> : null}
                </p>
                {a.note ? (
                  <p className="whitespace-pre-line text-body-sm text-fg-muted">{a.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body-sm text-fg-muted">{t("history.empty")}</p>
        )}
      </section>
    </div>
  );
}
