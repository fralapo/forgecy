import {
  and,
  appSettings,
  eq,
  gte,
  jobs,
  ne,
  migrationStatus,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { defineJob, enqueueJob, handle, type JobHandlers, type JobQueues } from "@forgecy/jobs";
import { z } from "zod";
import { createBackupArchive, pgDumpTo, pruneExpiredBackups } from "./archive";

/** Backup started from Settings › Backup (manual) or by the worker every night. */
export const systemBackupJob = defineJob({
  kind: "system.backup",
  queue: "default",
  payload: z.object({
    kind: z.enum(["manual", "nightly"]),
    includeMedia: z.boolean().default(true),
  }),
});

export interface BackupEnv {
  dataDir: string;
  mediaDir: string;
  databaseUrl: string;
  appVersion?: string | null;
}

export function backupHandlers(env: BackupEnv): JobHandlers {
  return handle(systemBackupJob, async (payload, ctx) => {
    await ctx.progress(5);
    const migrations = await migrationStatus(ctx.db).catch(() => null);
    const file = await createBackupArchive({
      dataDir: env.dataDir,
      mediaDir: env.mediaDir,
      dump: pgDumpTo(env.databaseUrl),
      kind: payload.kind,
      includeMedia: payload.includeMedia,
      createdBy: ctx.row.createdBy,
      appVersion: env.appVersion ?? null,
      lastMigration: migrations?.lastApplied ?? null,
    });
    await ctx.progress(90);
    const pruned = await pruneExpiredBackups(env.dataDir);
    await recordAuditEvent(ctx.db, {
      actor: "system",
      action: "backup_created",
      entity: "backup",
      entityId: file.name,
      meta: { kind: payload.kind, sizeBytes: file.sizeBytes, media: file.media, pruned },
    });
    await ctx.progress(100);
    return { name: file.name, sizeBytes: file.sizeBytes, pruned };
  });
}

export const NIGHTLY_SETTING_KEY = "backup.nightly";
/** Local hour (the installation's TZ) after which the nightly backup runs. */
export const NIGHTLY_HOUR = 2;

export async function nightlyBackupEnabled(db: Pick<Database, "select">): Promise<boolean> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, NIGHTLY_SETTING_KEY));
  return (row?.value as { enabled?: boolean } | undefined)?.enabled !== false;
}

/**
 * Called by the worker every few minutes: after 02:00 local time, enqueue tonight's
 * backup unless it is off, already queued, or already made today. Returns the job id.
 */
export async function maybeEnqueueNightlyBackup(
  db: Database,
  queues: JobQueues,
  now: Date = new Date(),
): Promise<string | null> {
  if (now.getHours() < NIGHTLY_HOUR) return null;
  if (!(await nightlyBackupEnabled(db))) return null;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, systemBackupJob.kind),
        sql`${jobs.payload}->>'kind' = 'nightly'`,
        // One per night: any attempt today counts, also a failed one (it shows on the page).
        gte(jobs.createdAt, midnight),
        ne(jobs.status, "cancelled"),
      ),
    )
    .limit(1);
  if (existing) return null;
  const row = await enqueueJob(db, queues, {
    kind: systemBackupJob,
    payload: { kind: "nightly", includeMedia: true },
  });
  return row.id;
}
