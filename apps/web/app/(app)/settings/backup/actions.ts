"use server";

import { deleteBackup, isBackupName, NIGHTLY_SETTING_KEY, systemBackupJob } from "@forgecy/backup";
import { and, appSettings, eq, getDb, inArray, jobs, recordAuditEvent } from "@forgecy/db";
import { resolveMediaRoot } from "@forgecy/files";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getQueues } from "@/lib/queues";
import { requireAdminAction, type AdminActionResult } from "../_lib/admin-action";

const PATH = "/settings/backup";

export async function createBackupAction(includeMedia: boolean): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("system.backup");
  if (denied) return denied;
  const t = await getTranslations("admin.backup");
  const db = getDb();
  const [running] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, systemBackupJob.kind),
        inArray(jobs.status, ["queued", "running", "retrying"]),
      ),
    )
    .limit(1);
  if (running) return { ok: false, error: t("create.alreadyRunning"), code: "BACKUP-RUNNING" };
  const job = await enqueueJob(db, await getQueues(), {
    kind: systemBackupJob,
    payload: { kind: "manual", includeMedia: includeMedia === true },
    createdBy: user.id,
  });
  await recordAuditEvent(db, {
    actor: user.actor,
    action: "backup_requested",
    entity: "job",
    entityId: job.id,
    meta: { includeMedia },
  });
  revalidatePath(PATH);
  return { ok: true, message: t("create.queued") };
}

export async function deleteBackupAction(name: string): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("system.backup");
  if (denied) return denied;
  const t = await getTranslations("admin.backup");
  if (!isBackupName(name)) return { ok: false, error: t("list.notFound"), code: "NOT-FOUND" };
  await deleteBackup(resolveMediaRoot(env.FORGECY_DATA_DIR), name);
  await recordAuditEvent(getDb(), {
    actor: user.actor,
    action: "backup_deleted",
    entity: "backup",
    entityId: name,
  });
  revalidatePath(PATH);
  return { ok: true, message: t("list.deleted") };
}

export async function setNightlyAction(enabled: boolean): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("system.backup");
  if (denied) return denied;
  const t = await getTranslations("admin.backup.nightly");
  const value = { enabled: enabled === true };
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: NIGHTLY_SETTING_KEY, value, updatedBy: user.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedBy: user.id, updatedAt: new Date() },
      });
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "nightly_backup_changed",
      entity: "app_settings",
      entityId: NIGHTLY_SETTING_KEY,
      meta: value,
    });
  });
  revalidatePath(PATH);
  return { ok: true, message: t(value.enabled ? "turnedOn" : "turnedOff") };
}
