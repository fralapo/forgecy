"use server";

import { startClientExport, type ExportInput } from "@forgecy/client-transfer";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireAdminAction, type AdminActionResult } from "../_lib/admin-action";

/** “Export client”: queues the full package (Admins only, checked again in the service). */
export async function startClientExportAction(input: ExportInput): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("clients.transfer");
  if (denied) return denied;
  const t = await getTranslations("clientTransfer.export");
  try {
    await startClientExport({ db: getDb(), queues: await getQueues() }, user.actor, input);
  } catch (err) {
    const error = await errorMessage(err);
    if (!error) throw err;
    return { ok: false, error };
  }
  revalidatePath("/settings/import-export");
  return { ok: true, message: t("started") };
}
