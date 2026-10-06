import { addSource, brandImportSourceJob, detectImportFile } from "@forgecy/brand";
import { assertCan, ForgecyError } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { contentKey, createStorageFromEnv, sha256 } from "@forgecy/files";
import { enqueueJob } from "@forgecy/jobs";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";
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
    const { clientSlug } = await ctx.params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client) throw new ForgecyError("not_found", "Cliente non trovato");
    assertCan(user.actor, "edit_draft", client.id);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ForgecyError("validation", "Scegli un file da importare.");
    const kindValue = String(form.get("kind") ?? "brand_book");
    const kind = (fileKinds as readonly string[]).includes(kindValue)
      ? (kindValue as (typeof fileKinds)[number])
      : "brand_book";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImportFile({ name: file.name, mime: file.type, bytes });
    if (!detected.ok) throw new ForgecyError("validation", detected.message);

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
      payload: { clientId: client.id, sourceId: source.id, requestedBy: user.id },
      clientId: client.id,
      entity: "brand_source",
      entityId: source.id,
      createdBy: user.id,
    });
    return NextResponse.json({ sourceId: source.id, jobId: job.id }, { status: 201 });
  },
);
