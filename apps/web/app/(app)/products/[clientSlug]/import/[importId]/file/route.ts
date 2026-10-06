import {
  addUploadedFile,
  importAiSetup,
  loadCatalogClient,
  MAX_UPLOAD_BYTES,
  spoolToTemp,
} from "@forgecy/catalog";
import { clients, eq, getDb } from "@forgecy/db";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { actingUser, getStorage, importErrorResponse } from "../../../../_lib/server";

export const dynamic = "force-dynamic";

/**
 * One file of an import, sent as the raw request body (folders are uploaded file by
 * file with their relative path in `x-file-path`). The body is streamed to a temp file
 * with a hard size cap; type and limits are checked from the content, not the name.
 */
export const POST = withUser(
  async (
    user,
    request: Request,
    { params }: { params: Promise<{ clientSlug: string; importId: string }> },
  ) => {
    const { clientSlug, importId } = await params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client || !request.body) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const catalogClient = await loadCatalogClient(db, client.id);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES)
      return NextResponse.json(
        {
          error: "IMPORT-TOO-LARGE",
          message: (await getTranslations("products"))("errors.uploadTooLarge"),
        },
        { status: 413 },
      );
    const relativePath = decodeURIComponent(request.headers.get("x-file-path") ?? "file").slice(
      0,
      1000,
    );
    try {
      const temp = await spoolToTemp(
        request.body as unknown as AsyncIterable<Uint8Array>,
        MAX_UPLOAD_BYTES,
      );
      try {
        const row = await addUploadedFile(db, getStorage(), actingUser(user), {
          clientId: client.id,
          importId,
          relativePath,
          temp,
          aiAvailable: importAiSetup(env, catalogClient.aiPolicy).available,
        });
        return NextResponse.json({
          id: row.id,
          valid: row.valid,
          message: row.message,
          errorCode: row.errorCode,
        });
      } finally {
        await temp.cleanup();
      }
    } catch (err) {
      const res = await importErrorResponse(err);
      if (res) return res;
      throw err;
    }
  },
);
