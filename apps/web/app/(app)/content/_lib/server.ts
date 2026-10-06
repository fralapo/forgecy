import "server-only";
import "./ports";
import { clients, eq, getDb } from "@forgecy/db";
import { notFound } from "next/navigation";
import { getStorage } from "@/app/render/_lib/templates";
import { requireUser } from "@/lib/session";

/** Client and signed-in user for a `[clientSlug]` page of the content module. */
export async function loadClient(slug: string) {
  const user = await requireUser();
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, slug) });
  if (!client) notFound();
  return { db, user, client };
}

/** Short-lived URLs for thumbnails of the client's library (keys are always the client's own). */
export async function thumbnailUrls(clientId: string, keys: readonly string[]) {
  const storage = getStorage();
  const own = [...new Set(keys)].filter((k) => k.startsWith(`clients/${clientId}/`));
  const pairs = await Promise.all(
    own.map(async (k) => [k, await storage.signedUrl(k, { expiresInSeconds: 600 })] as const),
  );
  return new Map(pairs);
}

export { getStorage };
