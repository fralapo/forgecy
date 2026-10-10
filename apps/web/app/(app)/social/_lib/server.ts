import "server-only";
import { can, canAccessClient } from "@forgecy/core";
import { clients, eq, getDb } from "@forgecy/db";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";

/** Time zone the posting heatmap is drawn in: the agency works in Italy. */
export const SOCIAL_TIME_ZONE = "Europe/Rome";

/** Client and signed-in user for a `[clientSlug]` page; a client the person may not open looks missing. */
export async function loadSocialClient(slug: string) {
  const user = await requireUser();
  const db = getDb();
  const client = await db.query.clients.findFirst({ where: eq(clients.slug, slug) });
  if (!client || !canAccessClient(user.actor, client.id)) notFound();
  return {
    db,
    user,
    client,
    canEdit: can(user.actor, "project.edit", client.id),
    isAdmin: can(user.actor, "settings.manage"),
  };
}

export const socialPath = (slug: string, handle?: string): string =>
  handle ? `/social/${slug}/${handle}` : `/social/${slug}`;
