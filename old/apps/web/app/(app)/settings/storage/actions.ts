"use server";

import { randomBytes } from "node:crypto";
import { contentKey, createStorageFromEnv, sha256 } from "@forgecy/files";
import { recordAuditEvent, getDb } from "@forgecy/db";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { requireAdminAction, type AdminActionResult } from "../_lib/admin-action";

/** Writes, reads back and deletes a small file through the configured driver. */
export async function storageWriteTestAction(): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("settings.manage");
  if (denied) return denied;
  const t = await getTranslations("admin.storage.test");
  const storage = createStorageFromEnv(env);
  const body = randomBytes(32);
  const key = contentKey({ scope: "write-test", sha256: sha256(body), ext: "txt" });
  const started = Date.now();
  let ok: boolean;
  try {
    await storage.put(key, body, { contentType: "text/plain" });
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.get(key)) chunks.push(Buffer.from(chunk));
    ok = Buffer.concat(chunks).equals(body);
  } catch {
    ok = false;
  } finally {
    await storage.delete(key).catch(() => undefined);
  }
  await recordAuditEvent(getDb(), {
    actor: user.actor,
    action: "storage_write_test",
    entity: "storage",
    entityId: storage.name,
    meta: { ok },
  });
  return ok
    ? { ok: true, message: t("ok", { ms: Date.now() - started }) }
    : { ok: false, error: t("failed"), code: "STORAGE-WRITE-FAILED" };
}
