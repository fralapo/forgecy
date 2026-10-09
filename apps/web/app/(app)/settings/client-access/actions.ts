"use server";

import { getDb, setClientAccess } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { requireAdminAction, type AdminActionResult } from "../_lib/admin-action";

const inputSchema = z.object({
  userId: z.uuid(),
  clientId: z.uuid(),
  granted: z.boolean(),
});

/** Assigns a client to a person or takes it away (ADR 0020). Admins only. */
export async function setClientAccessAction(input: {
  userId: string;
  clientId: string;
  granted: boolean;
}): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("users.manage");
  if (denied) return denied;
  const t = await getTranslations("admin.clientAccess");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalid"), code: "INPUT-INVALID" };
  await setClientAccess(getDb(), user.actor, parsed.data);
  revalidatePath("/settings/client-access");
  return { ok: true, message: t(parsed.data.granted ? "granted" : "revoked") };
}
