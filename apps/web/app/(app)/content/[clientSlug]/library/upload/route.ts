import { uploadAsset } from "@forgecy/content";
import { assertCan, ForgecyError, httpStatusFor } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";
import type { CurrentUser } from "@/lib/session";
import { getStorage } from "../../../_lib/server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Same-origin only: the session cookie alone must not be enough to upload (CSRF). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  const allowed = new Set([new URL(request.url).origin, new URL(env.FORGECY_BASE_URL).origin]);
  for (const o of env.ALLOWED_ORIGINS) allowed.add(o.replace(/\/$/, ""));
  return allowed.has(origin);
}

/** Domain errors as JSON with their message reference, so the form shows them translated. */
function errorResponse(err: unknown): Response {
  if (!(err instanceof ForgecyError) || err.code === "permission_denied") throw err;
  return NextResponse.json(
    { error: err.code, message: err.message, ref: err.ref ?? null },
    { status: httpStatusFor[err.code] },
  );
}

/**
 * Image upload into the client's library (PNG, JPEG, WebP up to 15 MB). A person's
 * upload is approved at once; an identical file returns the existing image. Answers
 * JSON to fetch, and redirects back to the library for a plain form post.
 */
export const POST = withUser(
  async (user, request: Request, ctx: { params: Promise<{ clientSlug: string }> }) => {
    if (!sameOrigin(request))
      throw new ForgecyError("permission_denied", "Request from a disallowed origin.");
    try {
      return await upload(user, request, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  },
);

async function upload(
  user: CurrentUser,
  request: Request,
  ctx: { params: Promise<{ clientSlug: string }> },
): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024)
    throw localizedError("validation", "content.library.errors.tooLarge");

  const { clientSlug } = await ctx.params;
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
  if (!client) throw localizedError("not_found", "content.errors.clientNotFound");
  assertCan(user.actor, "assets.upload", client.id);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw localizedError("validation", "content.library.errors.noFile");
  if (file.size > MAX_BYTES) throw localizedError("validation", "content.library.errors.tooLarge");
  if (!MIMES.has(file.type)) throw localizedError("validation", "content.library.errors.badFormat");

  const { row, created } = await uploadAsset(db, getStorage(), user.actor, {
    clientId: client.id,
    bytes: new Uint8Array(await file.arrayBuffer()),
    mime: file.type,
    alt: String(form.get("alt") ?? "").slice(0, 300),
  });
  if (!(request.headers.get("accept") ?? "").includes("application/json"))
    return NextResponse.redirect(new URL(`/content/${client.slug}/library`, request.url), 303);
  return NextResponse.json({ id: row.id, created }, { status: created ? 201 : 200 });
}
