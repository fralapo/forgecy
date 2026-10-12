"use server";

import {
  cancelClientImport,
  confirmClientImport,
  startClientExport,
  type ExportInput,
} from "@forgecy/client-transfer";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
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

/** “Import client” (end of the wizard): checks the choices again and queues the import. */
export async function confirmClientImportAction(
  importId: string,
  choices: unknown,
  confirmName?: string,
): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("clients.transfer");
  if (denied) return denied;
  const t = await getTranslations("clientTransfer.import");
  try {
    await confirmClientImport({ db: getDb(), queues: await getQueues() }, user.actor, importId, {
      choices,
      confirmName,
    });
  } catch (err) {
    const error = await errorMessage(err);
    if (!error) throw err;
    return { ok: false, error };
  }
  revalidatePath("/settings/import-export");
  return { ok: true, message: t("started") };
}

/** “Cancel import” before the confirmation: nothing was written. */
export async function cancelClientImportAction(importId: string): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("clients.transfer");
  if (denied) return denied;
  const t = await getTranslations("clientTransfer.import");
  const done = await cancelClientImport(
    { db: getDb(), storage: createStorageFromEnv(env) },
    user.actor,
    importId,
  );
  revalidatePath("/settings/import-export");
  return done
    ? { ok: true, message: t("cancelled") }
    : { ok: false, error: (await getTranslations("clientTransfer.errors"))("importNotReady") };
}
