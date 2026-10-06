import { discardsToCsv, importReview, loadCatalogClient } from "@forgecy/catalog";
import { clients, eq, getDb } from "@forgecy/db";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/** “Download rejected rows report”: rows and pages not imported, with the reason. */
export const GET = withUser(
  async (
    _user,
    _request: Request,
    { params }: { params: Promise<{ clientSlug: string; importId: string }> },
  ) => {
    const { clientSlug, importId } = await params;
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.slug, clientSlug) });
    if (!client || !/^[0-9a-f-]{36}$/i.test(importId))
      return new Response("Not found", { status: 404 });
    await loadCatalogClient(db, client.id);
    const review = await importReview(db, client.id, importId);
    if (!review) return new Response("Not found", { status: 404 });
    const rows = review.items
      .filter((i) => i.status === "discarded")
      .map((i) => ({
        reason: i.discardReason ?? "",
        source: ((i.origin as { fileName?: string } | null)?.fileName ?? "") as string,
      }));
    const invalidFiles = review.files
      .filter((f) => !f.valid)
      .map((f) => ({
        reason: `${f.message ?? "Invalid"}${f.errorCode ? ` (${f.errorCode})` : ""}`,
        source: f.path,
      }));
    return new Response(discardsToCsv([...invalidFiles, ...rows]), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rejected-import-${importId.slice(0, 8)}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
);
