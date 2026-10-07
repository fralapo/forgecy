import {
  and,
  appSettings,
  eq,
  gte,
  inArray,
  jobs,
  ne,
  migrationStatus,
  recordAuditEvent,
  sql,
  type Database,
} from "@forgecy/db";
import { applyMigrations } from "@forgecy/db/migrator";
import {
  defineJob,
  enqueueJob,
  errorMessage,
  handle,
  UnrecoverableError,
  type JobHandlers,
  type JobQueues,
} from "@forgecy/jobs";
import { z } from "zod";
import { createBackupArchive, isBackupName, pgDumpTo, pruneExpiredBackups } from "./archive";
import { psqlLoadInto, readRestoreStatus, restoreArchive, writeRestoreStatus } from "./restore";

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

/** Restore started from Settings › Backup, after validation and the typed confirmation. */
export const systemRestoreJob = defineJob({
  kind: "system.restore",
  queue: "default",
  payload: z.object({
    backup: z.string().refine(isBackupName),
    requestedBy: z.string().max(200),
  }),
});

const ACTIVE_JOB_STATUSES = ["queued", "running", "retrying"] as const;

export function backupHandlers(env: BackupEnv): JobHandlers {
  return {
    ...handle(systemBackupJob, async (payload, ctx) => {
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
    }),
    ...handle(systemRestoreJob, async (payload, ctx) => {
      const started = await readRestoreStatus(env.dataDir);
      const base = {
        backup: payload.backup,
        requestedBy: payload.requestedBy,
        requestedAt: started?.requestedAt ?? new Date().toISOString(),
        ...(started?.requestedById ? { requestedById: started.requestedById } : {}),
      };
      let preRestoreBackup: string | undefined;
      try {
        await writeRestoreStatus(env.dataDir, { ...base, state: "running" });
        await ctx.progress(5);
        // Safe default (spec): the current state is saved before anything is replaced.
        const migrations = await migrationStatus(ctx.db).catch(() => null);
        const pre = await createBackupArchive({
          dataDir: env.dataDir,
          mediaDir: env.mediaDir,
          dump: pgDumpTo(env.databaseUrl),
          kind: "pre_restore",
          includeMedia: true,
          createdBy: ctx.row.createdBy,
          appVersion: env.appVersion ?? null,
          lastMigration: migrations?.lastApplied ?? null,
        });
        preRestoreBackup = pre.name;
        await writeRestoreStatus(env.dataDir, { ...base, state: "running", preRestoreBackup });
        await ctx.progress(40);
        // From here the jobs table is the backup's: this job's row is gone.
        const { media } = await restoreArchive({
          dataDir: env.dataDir,
          mediaDir: env.mediaDir,
          name: payload.backup,
          load: psqlLoadInto(env.databaseUrl),
        });
        await applyMigrations(env.databaseUrl);
        // Jobs that were active when the backup was made are not in the queue any more.
        const cancelled = await ctx.db
          .update(jobs)
          .set({ status: "cancelled", endedAt: new Date() })
          .where(inArray(jobs.status, [...ACTIVE_JOB_STATUSES]))
          .returning({ id: jobs.id });
        await recordAuditEvent(ctx.db, {
          actor: "system",
          action: "backup_restored",
          entity: "backup",
          entityId: payload.backup,
          meta: {
            requestedBy: payload.requestedBy,
            preRestoreBackup,
            media,
            cancelledJobs: cancelled.length,
          },
        });
        await writeRestoreStatus(env.dataDir, {
          ...base,
          state: "completed",
          preRestoreBackup,
          finishedAt: new Date().toISOString(),
        });
        return { backup: payload.backup, preRestoreBackup, media };
      } catch (err) {
        await writeRestoreStatus(env.dataDir, {
          ...base,
          state: "failed",
          ...(preRestoreBackup ? { preRestoreBackup } : {}),
          finishedAt: new Date().toISOString(),
          error: errorMessage(err),
        }).catch(() => undefined);
        // Never retried on its own: a half restore needs a person to look at it.
        throw new UnrecoverableError(errorMessage(err));
      }
    }),
  };
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
