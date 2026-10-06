import { addSource, brandImportSourceJob, detectImportFile } from "@forgecy/brand";
import { assertCan, ForgecyError, httpStatusFor } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { contentKey, createStorageFromEnv, sha256 } from "@forgecy/files";
import { localizedError } from "@forgecy/i18n";
import { enqueueJob } from "@forgecy/jobs";
import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { withUser } from "@/lib/api";
import type { CurrentUser } from "@/lib/session";
import { env } from "@/lib/env";
import { errorMessage } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";

export const dynamic = "force-dynamic";

const fileKinds = [
  "brand_book",
  "document",
  "screenshot",
  "questionnaire",
  "interview",
  "client_approval",
] as const;

/**
 * Brand book import (UX Flow D): stores the file, registers the source and queues
 * the extraction. A route handler, not a server action: files reach 50 MB.
 */
export const POST = withUser(
  async (user, request: Request, ctx: { params: Promise<{ clientSlug: string }> }) => {
    try {
      return await upload(user, request, ctx);
    } catch (err) {
      // The form shows `message`: in the user's language when the error carries a reference.
      if (err instanceof ForgecyError && err.code !== "permission_denied")
        return NextResponse.json(
          { error: err.code, message: (await errorMessage(err)) ?? err.message },
          { status: httpStatusFor[err.code] },
        );
      throw err;
    }
  },
);

async function upload(
  user: CurrentUser,
  request: Request,
  ctx: { params: Promise<{ clientSlug: string }> },
) {
  const { clientSlug } = await ctx.params;
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
  if (!client) throw localizedError("not_found", "brand.errors.clientNotFound");
  assertCan(user.actor, "edit_draft", client.id);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw localizedError("validation", "brand.errors.chooseFile");
  const kindValue = String(form.get("kind") ?? "brand_book");
  const kind = (fileKinds as readonly string[]).includes(kindValue)
    ? (kindValue as (typeof fileKinds)[number])
    : "brand_book";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectImportFile({ name: file.name, mime: file.type, bytes });
  if (!detected.ok) throw new ForgecyError("validation", detected.message, undefined, detected.ref);

  const hash = sha256(bytes);
  const key = contentKey({
    clientId: client.id,
    scope: "brand-sources",
    sha256: hash,
    ext: detected.ext,
  });
  const storage = createStorageFromEnv(env);
  if (!(await storage.exists(key))) await storage.put(key, bytes, { contentType: detected.mime });

  const source = await addSource(db, user.actor, {
    clientId: client.id,
    kind: detected.type === "font" ? "document" : kind,
    title: (String(form.get("title") ?? "").trim() || file.name).slice(0, 300),
    storageKey: key,
    mime: detected.mime,
    size: bytes.byteLength,
    sha256: hash,
    status: "pending",
  });
  const job = await enqueueJob(db, await getQueues(), {
    kind: brandImportSourceJob,
    payload: {
      clientId: client.id,
      sourceId: source.id,
      requestedBy: user.id,
      language: await getLocale(),
    },
    clientId: client.id,
    entity: "brand_source",
    entityId: source.id,
    createdBy: user.id,
  });
  return NextResponse.json({ sourceId: source.id, jobId: job.id }, { status: 201 });
}
