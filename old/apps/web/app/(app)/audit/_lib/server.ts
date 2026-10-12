import "server-only";
import { auditErrorCode, type AuditDeps } from "@forgecy/audit";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { and, desc, eq, getDb, jobs, socialProfiles, type Database } from "@forgecy/db";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import {
  createSocialRuntime,
  normalizeHandle,
  SOCIAL_JOB_ENTITY,
  socialSnapshotJob,
} from "@forgecy/social";
import type { ZodError } from "zod";
import { env } from "@/lib/env";
import { errorMessage, firstIssue } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";

let storage: StorageDriver | undefined;

export function auditStorage(): StorageDriver {
  storage ??= createStorageFromEnv(env);
  return storage;
}

export async function auditDeps(): Promise<AuditDeps> {
  return { db: getDb(), queues: await getQueues(), storage: auditStorage() };
}

/** Read-only deps: no Redis connection needed to render a page. */
export function readDeps(): AuditDeps {
  return { db: getDb(), storage: auditStorage() };
}

/** Short-lived URL for a stored screenshot or file. */
export async function fileUrl(key: string | null | undefined, download?: string) {
  if (!key) return null;
  return auditStorage().signedUrl(key, {
    expiresInSeconds: 15 * 60,
    ...(download ? { disposition: "attachment" as const, filename: download } : {}),
  });
}

/** Whether at least one source that reads Instagram profiles is set up in this installation. */
export function profileReadingAvailable(): boolean {
  return createSocialRuntime(env).available().length > 0;
}

/**
 * The profile reading behind an audit's Instagram link (ADR 0023): the reading in flight, if
 * any, and the stored reason of the last failure. The job belongs to the profile, not to the
 * audit, so the audit's own job list does not show it.
 */
export async function profileReadingState(db: Database, clientId: string, profileUrl: string) {
  const handle = normalizeHandle(profileUrl);
  const none = { job: null, reason: null, jobFailure: null } as const;
  if (!handle) return none;
  const [profile] = await db
    .select({ id: socialProfiles.id, reason: socialProfiles.statusReason })
    .from(socialProfiles)
    .where(and(eq(socialProfiles.clientId, clientId), eq(socialProfiles.handle, handle)));
  if (!profile) return none;
  // The latest reading job, whatever its state: a job that failed at queue level (no handler,
  // worker down) never reaches the profile's own reason, so its error is read from the job.
  const [latest] = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      progress: jobs.progress,
      error: jobs.error,
      errorRef: jobs.errorRef,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.entity, SOCIAL_JOB_ENTITY),
        eq(jobs.entityId, profile.id),
        eq(jobs.kind, socialSnapshotJob.kind),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const job = latest && ACTIVE_JOB.includes(latest.status) ? latest : null;
  const jobFailure =
    latest?.status === "failed"
      ? { error: latest.error ?? "", errorRef: latest.errorRef ?? null }
      : null;
  return { job, reason: profile.reason, jobFailure };
}

const ACTIVE_JOB: readonly string[] = ["queued", "retrying", "running"];

export type ActionResult<T = undefined> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: string };

/** Map domain errors to a message people can act on (in their language), with the stable code. */
export async function toActionError(
  err: unknown,
): Promise<{ ok: false; error: string; code?: string }> {
  const code = auditErrorCode(err) ?? undefined;
  if (err instanceof PermissionDeniedError)
    return { ok: false, error: (await errorMessage(err)) ?? err.message, code: "PERM-DENIED" };
  if (err instanceof ForgecyError)
    return {
      ok: false,
      error: (await errorMessage(err)) ?? err.message,
      ...(code ? { code } : {}),
    };
  if (err && typeof err === "object" && "issues" in err)
    return { ok: false, error: await firstIssue(err as ZodError), code: "INPUT-INVALID" };
  throw err;
}
