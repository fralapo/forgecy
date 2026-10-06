import { addProductImage, IMPORT_LIMITS, loadCatalogClient, spoolToTemp } from "@forgecy/catalog";
import { clients, eq, getDb } from "@forgecy/db";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { actingUser, getStorage, importErrorResponse } from "../../../_lib/server";

export const dynamic = "force-dynamic";

/** “Add image”: raw body upload, streamed to a temp file with a size cap. */
export const POST = withUser(
  async (
    user,
    request: Request,
    { params }: { params: Promise<{ clientSlug: string; productId: string }> },
  ) => {
    const { clientSlug, productId } = await params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client || !request.body) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await loadCatalogClient(db, client.id);
    const fileName = decodeURIComponent(request.headers.get("x-file-name") ?? "image").slice(
      0,
      300,
    );
    try {
      const temp = await spoolToTemp(
        request.body as unknown as AsyncIterable<Uint8Array>,
        IMPORT_LIMITS.imageBytes,
      );
      try {
        await addProductImage(db, getStorage(), actingUser(user), {
          clientId: client.id,
          productId,
          fileName,
          temp,
        });
      } finally {
        await temp.cleanup();
      }
    } catch (err) {
      const res = importErrorResponse(err);
      if (res) return res;
      throw err;
    }
    return NextResponse.json({ ok: true });
  },
);
