import { discardsToCsv, importReview, loadCatalogClient, type FileMeta } from "@forgecy/catalog";
import { clients, eq, getDb } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { withUser } from "@/lib/api";
import { refText } from "@/lib/i18n";
import { csvLabels, discardText } from "../../../../_lib/labels";

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
    const t = await getTranslations("products");
    const rows = await Promise.all(
      review.items
        .filter((i) => i.status === "discarded")
        .map(async (i) => ({
          reason: await refText(i.discardRef, discardText(t, i.discardReason ?? "")),
          source: ((i.origin as { fileName?: string } | null)?.fileName ?? "") as string,
        })),
    );
    const invalidFiles = await Promise.all(
      review.files
        .filter((f) => !f.valid)
        .map(async (f) => {
          const message = await refText(
            (f.meta as FileMeta | null)?.messageRef,
            f.message ?? t("files.invalid"),
          );
          return {
            reason: f.errorCode ? t("errors.withCode", { message, code: f.errorCode }) : message,
            source: f.path,
          };
        }),
    );
    return new Response(discardsToCsv([...invalidFiles, ...rows], csvLabels(t)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rejected-import-${importId.slice(0, 8)}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
);
