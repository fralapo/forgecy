import { NEUTRAL_BRAND, renderSlideHtml } from "@forgecy/carousel";
import { collectAssetKeys, resolveAssets } from "@forgecy/carousel/node";
import { getContentRow, loadBrand, parseDocument, toRenderSlide } from "@forgecy/content";
import { assertCan } from "@forgecy/core";
import { and, clients, contentVersions, eq, getDb } from "@forgecy/db";
import { NextResponse } from "next/server";
import { catalogSource, getStorage, slideResponse } from "@/app/render/_lib/templates";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * One slide of a carousel rendered by the export renderer, with the client's brand
 * (the version pinned on the content) and its own library images. `?slide=<id>` or
 * `?index=<n>` picks the slide; `?version=current` (or a version id) reads the
 * version under review instead of the draft; `?safe=1` draws the safe zone.
 */
export const GET = withUser(
  async (
    user,
    request: Request,
    { params }: { params: Promise<{ clientSlug: string; contentId: string }> },
  ) => {
    const { clientSlug, contentId } = await params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client) return notFound();
    assertCan(user.actor, "view", client.id);
    const c = await getContentRow(db, client.id, contentId);
    const q = new URL(request.url).searchParams;

    let doc = parseDocument(c.draft);
    let brandVersionId = c.brandVersionId;
    let templateVersion = c.templateVersion;
    const versionParam = q.get("version");
    if (versionParam) {
      const versionId = versionParam === "current" ? c.currentVersionId : versionParam;
      if (!versionId || !/^[0-9a-f-]{36}$/i.test(versionId)) return notFound();
      const [v] = await db
        .select()
        .from(contentVersions)
        .where(and(eq(contentVersions.id, versionId), eq(contentVersions.contentId, c.id)));
      if (!v) return notFound();
      doc = parseDocument(v.document);
      brandVersionId = v.brandVersionId ?? c.brandVersionId;
      const meta = (v.meta ?? {}) as { templateVersion?: string | null };
      templateVersion = meta.templateVersion ?? c.templateVersion;
    }

    const slideParam = q.get("slide");
    const indexParam = Number(q.get("index") ?? 0);
    const index = slideParam
      ? doc.slides.findIndex((s) => s.id === slideParam)
      : Number.isInteger(indexParam)
        ? indexParam
        : -1;
    const contentSlide = doc.slides[index];
    if (!contentSlide) return notFound();

    const [pkg, brand] = await Promise.all([
      catalogSource().get(c.templateKey, templateVersion ?? undefined),
      loadBrand(db, user.actor, {
        clientId: client.id,
        clientName: client.name,
        versionId: brandVersionId,
      }),
    ]);
    if (!pkg) return notFound();
    const theme = brand?.theme ?? NEUTRAL_BRAND;
    const slide = toRenderSlide(contentSlide);

    // Only the client's own files; a missing file leaves its slot empty instead of failing the preview.
    const keys = collectAssetKeys([slide], theme).filter((k) =>
      k.startsWith(`clients/${client.id}/`),
    );
    const storage = getStorage();
    const resolved = await Promise.all(
      keys.map((k) =>
        resolveAssets(storage, client.id, [k]).catch(() => new Map<string, string>()),
      ),
    );
    const assets = new Map(resolved.flatMap((m) => [...m]));

    const { html } = renderSlideHtml({
      pkg,
      slide,
      index,
      total: doc.slides.length,
      brand: theme,
      assets,
      options: { showSafeZone: q.get("safe") === "1" },
    });
    return slideResponse(html);
  },
);
