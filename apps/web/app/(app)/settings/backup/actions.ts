"use server";

import {
  agencyName,
  deleteBackup,
  inspectBackup,
  isBackupName,
  NIGHTLY_SETTING_KEY,
  readRestoreStatus,
  restoreInProgress,
  systemBackupJob,
  systemRestoreJob,
  writeRestoreStatus,
  type RestoreProblem,
} from "@forgecy/backup";
import {
  and,
  appSettings,
  getDb,
  inArray,
  jobs,
  recordAuditEvent,
  shippedMigrations,
} from "@forgecy/db";
import { resolveMediaRoot } from "@forgecy/files";
import { enqueueJob } from "@forgecy/jobs";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { getQueues } from "@/lib/queues";
import { requireAdminAction, type ActionError, type AdminActionResult } from "../_lib/admin-action";

const PATH = "/settings/backup";
const ACTIVE = ["queued", "running", "retrying"] as const;

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
        inArray(jobs.kind, [systemBackupJob.kind, systemRestoreJob.kind]),
        inArray(jobs.status, [...ACTIVE]),
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

export type RestoreCheck =
  | {
      ok: true;
      createdAt: string | null;
      media: boolean;
      appVersion: string | null;
      lastMigration: string | null;
      problems: RestoreProblem[];
      migrationsToApply: number;
    }
  | ActionError;

/** Validation step of the restore: reads only the archive's manifest. */
export async function checkRestoreAction(name: string): Promise<RestoreCheck> {
  const { denied } = await requireAdminAction("system.backup");
  if (denied) return denied;
  const t = await getTranslations("admin.backup.restore");
  if (!isBackupName(name)) return { ok: false, error: t("notFound"), code: "NOT-FOUND" };
  const res = await inspectBackup(resolveMediaRoot(env.FORGECY_DATA_DIR), name, shippedMigrations);
  return {
    ok: true,
    createdAt: res.manifest?.createdAt ?? null,
    media: res.manifest?.media ?? false,
    appVersion: res.manifest?.appVersion ?? null,
    lastMigration: res.manifest?.lastMigration ?? null,
    problems: res.problems,
    migrationsToApply: res.migrationsToApply,
  };
}

const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;

export async function startRestoreAction(
  name: string,
  confirmation: string,
): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("system.backup");
  if (denied) return denied;
  const t = await getTranslations("admin.backup.restore");
  const db = getDb();
  const dataDir = resolveMediaRoot(env.FORGECY_DATA_DIR);
  if (!isBackupName(name)) return { ok: false, error: t("notFound"), code: "NOT-FOUND" };
  // Checked again on the server: the form is only a convenience.
  if (typeof confirmation !== "string" || !sameName(confirmation, await agencyName(db)))
    return { ok: false, error: t("confirmMismatch"), code: "CONFIRM-MISMATCH" };
  const check = await inspectBackup(dataDir, name, shippedMigrations);
  const problem = check.problems[0];
  if (problem) return { ok: false, error: t(`problem.${problem}`), code: "BACKUP-INVALID" };
  const [busy] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.kind, [systemBackupJob.kind, systemRestoreJob.kind]),
        inArray(jobs.status, [...ACTIVE]),
      ),
    )
    .limit(1);
  if (busy || restoreInProgress(await readRestoreStatus(dataDir)))
    return { ok: false, error: t("busy"), code: "RESTORE-BUSY" };
  const requestedAt = new Date().toISOString();
  await writeRestoreStatus(dataDir, {
    state: "queued",
    backup: name,
    requestedBy: user.name,
    requestedById: user.id,
    requestedAt,
  });
  const job = await enqueueJob(db, await getQueues(), {
    kind: systemRestoreJob,
    payload: { backup: name, requestedBy: user.name },
    createdBy: user.id,
  });
  await recordAuditEvent(db, {
    actor: user.actor,
    action: "restore_requested",
    entity: "backup",
    entityId: name,
    meta: { jobId: job.id },
  });
  revalidatePath(PATH);
  return { ok: true, message: t("queued") };
}
