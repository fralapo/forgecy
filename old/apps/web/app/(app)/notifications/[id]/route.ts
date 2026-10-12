import { and, eq, getDb, markNotificationsRead, notifications } from "@forgecy/db";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";

/** Opens a notification: marks it read and goes to its page (only the reader's own). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  const fallback = new URL("/notifications", env.FORGECY_BASE_URL);
  if (!id.success) return NextResponse.redirect(fallback);
  const db = getDb();
  const [row] = await db
    .select({ href: notifications.href })
    .from(notifications)
    .where(and(eq(notifications.id, id.data), eq(notifications.userId, user.id)));
  if (!row) return NextResponse.redirect(fallback);
  await markNotificationsRead(db, user.id, [id.data]);
  // Only paths inside the app: never another origin.
  const safe = row.href.startsWith("/") && !row.href.startsWith("//");
  return NextResponse.redirect(safe ? new URL(row.href, env.FORGECY_BASE_URL) : fallback);
}
