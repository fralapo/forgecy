"use server";

import { getDb, markNotificationsRead } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";

/** “Mark all as read”: only the reader's own notifications. */
export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markNotificationsRead(getDb(), user.id);
  revalidatePath("/", "layout");
}
