import {
  checkDocument,
  contentStatusLabels,
  findingsToAcknowledge,
  imageKeys,
  parseDocument,
} from "@forgecy/content";
import { findLayout } from "@forgecy/carousel";
import { can } from "@forgecy/core";
import { and, contentVersions, eq } from "@forgecy/db";
import { Badge, Card } from "@forgecy/ui";
import Link from "next/link";
import type { Route } from "next";
import { SlideFrame } from "@/app/(app)/templates/slide-frame";
import { ReviewComments, type ReviewComment } from "../../../../_components/review-comments";
import { ReviewForm, type PendingImage } from "../../../../_components/review-form";
import { carouselPath, formatDate } from "../../../../_lib/paths";
import { thumbnailUrls } from "../../../../_lib/server";
import { loadCarousel } from "../../_lib/workspace";

export const metadata = { title: "Revisione del carosello" };

const decisionLabels = { approved: "Approvato", changes_requested: "Modifiche richieste" } as const;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { db, user, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
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
            {version ? `Versione ${version.number}` : "Nessuna versione"}
          </h2>
          <Badge variant={inReview ? "warning" : "neutral"}>{contentStatusLabels[c.status]}</Badge>
        </div>
        {version ? (
          <p className="text-body-sm text-fg-muted">
            Creata {versionAuthor ? `da ${versionAuthor} ` : ""}il {formatDate(version.createdAt)}
          </p>
        ) : null}
        {!inReview ? (
          <p className="text-body-sm text-fg">
            Il carosello non è in revisione.{" "}
            {c.status === "draft" || c.status === "changes_requested" ? (
              <Link href={`${base}/editor` as Route}>Apri l&apos;editor</Link>
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
            Slide
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
                    title={`Slide ${i + 1}`}
                    width={manifest.width}
                    height={manifest.height}
                    scale={scale}
                  />
                  <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg">
                    {i + 1}. {findLayout(manifest, s.layout)?.name ?? s.layout}
                    {findings.length ? (
                      <Badge variant="warning">{findings.length} segnalazioni</Badge>
                    ) : null}
                  </p>
                  {s.note ? <p className="text-body-sm text-fg-muted">Nota: {s.note}</p> : null}
                  <ReviewComments
                    {...ref}
                    slideId={s.id}
                    label={`slide ${i + 1}`}
                    comments={comments(s.id)}
                    canComment={canComment}
                  />
                </li>
              );
            })}
          </ol>
          <div className="space-y-2">
            <h3 className="text-label text-fg">Didascalia</h3>
            <p className="whitespace-pre-line text-body-sm text-fg">{doc.caption || "—"}</p>
            {doc.hashtags.length ? (
              <p className="text-body-sm text-fg-muted">{doc.hashtags.join(" ")}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <h3 className="text-label text-fg">Commenti sul carosello</h3>
            <ReviewComments
              {...ref}
              slideId={null}
              label="carosello"
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
          Cronologia delle approvazioni
        </h2>
        {ws.approvals.length ? (
          <ol className="space-y-3">
            {ws.approvals.map((a) => (
              <li key={a.id} className="space-y-1 rounded-md border border-subtle bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2 text-body-sm text-fg">
                  <Badge variant={a.decision === "approved" ? "success" : "error"}>
                    {decisionLabels[a.decision]}
                  </Badge>
                  Versione {versionNumbers.get(a.versionId) ?? "—"} ·{" "}
                  {a.deciderName ?? "Utente rimosso"} · {formatDate(a.decidedAt)}
                  {a.selfApproval ? <Badge>Auto-approvazione</Badge> : null}
                </p>
                {a.note ? (
                  <p className="whitespace-pre-line text-body-sm text-fg-muted">{a.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body-sm text-fg-muted">Nessuna decisione finora.</p>
        )}
      </section>
    </div>
  );
}
