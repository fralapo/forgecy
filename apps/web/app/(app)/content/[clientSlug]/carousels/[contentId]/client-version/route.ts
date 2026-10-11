import { attachClientVersion, CLIENT_VERSION_MAX_SLIDES, type ClientFile } from "@forgecy/content";
import { assertCan, ForgecyError, httpStatusFor } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { getStorage } from "../../../../_lib/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_PDF = 30 * 1024 * 1024;
const MAX_TOTAL = 120 * 1024 * 1024;

/** Same-origin only: the session cookie alone must not be enough to upload (CSRF). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const allowed = new Set([new URL(request.url).origin, new URL(env.FORGECY_BASE_URL).origin]);
  for (const o of env.ALLOWED_ORIGINS) allowed.add(o.replace(/\/$/, ""));
  return allowed.has(origin);
}

const asFile = async (f: File): Promise<ClientFile> => ({
  bytes: new Uint8Array(await f.arrayBuffer()),
  mime: f.type,
  name: f.name,
});

/**
 * Attach the client's edited version of a published carousel: up to 20 slide images
 * (`slides`) and/or one PDF (`pdf`). People with the right to upload and publish only.
 */
export const POST = withUser(
  async (
    user,
    request: Request,
    ctx: { params: Promise<{ clientSlug: string; contentId: string }> },
  ) => {
    if (!sameOrigin(request))
      throw new ForgecyError("permission_denied", "Request from a disallowed origin.");
    try {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_TOTAL)
        throw localizedError("validation", "content.library.errors.tooLarge");
      const { clientSlug, contentId } = await ctx.params;
      const db = getDb();
      const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
      if (!client) throw localizedError("not_found", "content.errors.clientNotFound");
      assertCan(user.actor, "assets.upload", client.id);
      const form = await request.formData();
      const slideFiles = form
        .getAll("slides")
        .filter((f): f is File => f instanceof File && f.size > 0);
      const pdfFile = form.get("pdf");
      if (slideFiles.length > CLIENT_VERSION_MAX_SLIDES)
        throw localizedError("validation", "content.errors.clientVersionTooMany", {
          max: CLIENT_VERSION_MAX_SLIDES,
        });
      if (
        slideFiles.some((f) => f.size > MAX_IMAGE) ||
        (pdfFile instanceof File && pdfFile.size > MAX_PDF)
      )
        throw localizedError("validation", "content.library.errors.tooLarge");
      await attachClientVersion(db, getStorage(), user.actor, {
        clientId: client.id,
        id: contentId,
        slides: await Promise.all(slideFiles.map(asFile)),
        pdf: pdfFile instanceof File && pdfFile.size > 0 ? await asFile(pdfFile) : null,
      });
      revalidatePath(`/content/${clientSlug}`, "layout");
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (!(err instanceof ForgecyError) || err.code === "permission_denied") throw err;
      return NextResponse.json(
        { error: err.code, message: err.message, ref: err.ref ?? null },
        { status: httpStatusFor[err.code] },
      );
    }
  },
);
