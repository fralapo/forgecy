import { getPublishedBrandIdentity } from "@forgecy/brand";
import {
  assetCommercialUse,
  briefSchema,
  latestClaimFindings,
  sourceTextOf,
  type ContentChannel,
} from "@forgecy/content";
import { eq, users } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { getRefText } from "@/lib/i18n";
import { ClaimCheck } from "../../../../_components/claim-check";
import { EditorWorkspace, type EditorAsset } from "../../../../_components/editor-workspace";
import { carouselPath } from "../../../../_lib/paths";
import { thumbnailUrls } from "../../../../_lib/server";
import { isActiveJob, loadCarousel } from "../../_lib/workspace";

export async function generateMetadata() {
  const t = await getTranslations("content.editor");
  return { title: t("metaTitle") };
}

type Generation = { commercialUse?: string; slideId?: string; slot?: string; provider?: string };

export default async function EditorPage({
  params,
}: {
  params: Promise<{ clientSlug: string; contentId: string }>;
}) {
  const { clientSlug, contentId } = await params;
  const { db, user, client, ws } = await loadCarousel(clientSlug, contentId);
  const c = ws.content;
  const rt = await getRefText();
  const [claims, brand, updatedBy] = await Promise.all([
    latestClaimFindings(db, c.id),
    getPublishedBrandIdentity(db, user.actor, client.id),
    c.draftUpdatedBy
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, c.draftUpdatedBy))
          .then((r) => r[0]?.name ?? null)
      : null,
  ]);
  const thumbs = await thumbnailUrls(
    client.id,
    ws.library.map((a) => a.storageKey),
  );
  const library: EditorAsset[] = ws.library.map((a) => {
    const g = (a.generation ?? {}) as Generation;
    return {
      id: a.id,
      key: a.storageKey,
      status: a.status,
      source: a.source,
      alt: a.alt,
      width: a.width,
      height: a.height,
      thumb: thumbs.get(a.storageKey) ?? null,
      commercialUse: assetCommercialUse(a),
      slideId: g.slideId ?? null,
      slot: g.slot ?? null,
      forThisContent: a.contentId === c.id,
    };
  });
  const brief = briefSchema.parse(c.brief ?? {});
  const maxHashtags = brand?.document.verbal.writingRules?.value.maxHashtags;
  const base = carouselPath(client.slug, c.id);

  const claimJobs = ws.jobs.filter((j) => j.kind === "content.critique_claims");

  return (
    <>
      <ClaimCheck
        slug={client.slug}
        clientId={client.id}
        contentId={c.id}
        running={claimJobs.some((j) => isActiveJob(j.status))}
        disabled={!ws.document.slides.length || c.status === "in_review" || c.status === "archived"}
        lastCount={
          claimJobs.some((j) => j.status === "completed")
            ? (ws.checks?.checks.filter((x) => x.id.startsWith("claim:")).length ?? 0)
            : null
        }
      />
      <EditorWorkspace
        key={c.id}
        slug={client.slug}
        clientId={client.id}
        contentId={c.id}
        basePath={base}
        status={c.status}
        locked={ws.locked}
        busy={ws.locked || ws.jobs.some((j) => isActiveJob(j.status))}
        reviewNote={c.status === "changes_requested" ? c.reviewNote : null}
        draftRev={c.draftRev}
        document={ws.document}
        updatedByName={updatedBy}
        updatedAt={c.draftUpdatedAt?.toISOString() ?? null}
        manifest={ws.template?.manifest ?? null}
        channel={c.channel as ContentChannel}
        checkContext={{
          forbiddenWords: brand?.document.verbal.forbiddenWords ?? [],
          ...(maxHashtags !== undefined ? { maxHashtags } : {}),
          usePrice: brief.usePrice,
          wantsAltText: brief.outputs.altText,
          captionLength: brief.outputs.captionLength,
          claims,
          sourceText: sourceTextOf(brief, ws.product),
          productRevision: c.productId
            ? { used: c.productRevision, current: ws.product?.revision ?? null }
            : null,
          brandVersion: { used: c.brandVersionId, current: brand?.versionId ?? null },
        }}
        guard={ws.checks?.guard ?? null}
        library={library}
        edits={ws.edits.map((e) => ({
          id: e.id,
          slideId: e.slideId,
          instruction: e.instruction,
          status: e.status,
          note: rt(e.noteRef, e.note ?? "") || null,
          createdAt: e.createdAt.toISOString(),
        }))}
        comments={ws.comments
          .filter((m) => !m.resolvedAt)
          .map((m) => ({
            id: m.id,
            slideId: m.slideId,
            body: m.body,
            authorName: m.authorName,
            createdAt: m.createdAt.toISOString(),
          }))}
      />
    </>
  );
}
