import { assertCan, SOCIAL_LIMITS, type Actor, type SocialProfileRole } from "@forgecy/core";
import {
  and,
  eq,
  inArray,
  jobs,
  recordAuditEvent,
  socialProfiles,
  sql,
  type Database,
} from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { enqueueJob, type JobQueues } from "@forgecy/jobs";
import { normalizeHandle } from "../analysis/text";
import { SOCIAL_JOB_ENTITY, socialSnapshotJob } from "../jobs";
import type { ProfileRow } from "./rows";
import { clearSourceBlocked } from "./state";
import type { LiveSource } from "./runtime";

export interface SocialServiceDeps {
  db: Database;
  queues?: JobQueues;
}

export function userIdOf(actor: Actor): string | null {
  return actor.type === "user" ? actor.id : null;
}

export async function loadProfile(db: Database, profileId: string): Promise<ProfileRow> {
  const [row] = await db.select().from(socialProfiles).where(eq(socialProfiles.id, profileId));
  if (!row) throw localizedError("not_found", "social.errors.profileNotFound");
  return row;
}

/** A profile the actor may edit; the client check comes from `can()`. */
async function editableProfile(db: Database, actor: Actor, profileId: string) {
  const profile = await loadProfile(db, profileId);
  assertCan(actor, "project.edit", profile.clientId);
  return profile;
}

export async function hasActiveSnapshotJob(db: Database, profileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.entity, SOCIAL_JOB_ENTITY),
        eq(jobs.entityId, profileId),
        eq(jobs.kind, socialSnapshotJob.kind),
        inArray(jobs.status, ["queued", "retrying", "running"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Queue one read of the profile now. */
export async function requestSnapshot(
  deps: SocialServiceDeps,
  actor: Actor,
  profileId: string,
  delayMs = 0,
  auditId?: string,
) {
  const profile = await editableProfile(deps.db, actor, profileId);
  if (!deps.queues) throw localizedError("unavailable", "social.errors.queueUnavailable");
  if (await hasActiveSnapshotJob(deps.db, profile.id))
    throw localizedError("conflict", "social.errors.snapshotInProgress");
  return enqueueJob(deps.db, deps.queues, {
    kind: socialSnapshotJob,
    payload: { profileId: profile.id, ...(auditId ? { auditId } : {}) },
    clientId: profile.clientId,
    entity: SOCIAL_JOB_ENTITY,
    entityId: profile.id,
    createdBy: userIdOf(actor),
    ...(delayMs ? { delayMs } : {}),
  });
}

export interface AddProfileInput {
  clientId: string;
  /** A link, @name or name. */
  handle: string;
  role?: SocialProfileRole;
  auditId?: string | null;
  monitored?: boolean;
  intervalHours?: number;
  /** Queue the first read right away (needs queues in deps). */
  readNow?: boolean;
}

export async function addProfile(
  deps: SocialServiceDeps,
  actor: Actor,
  input: AddProfileInput,
): Promise<ProfileRow> {
  assertCan(actor, "project.edit", input.clientId);
  const handle = normalizeHandle(input.handle);
  if (!handle) throw localizedError("validation", "social.errors.invalidHandle");
  const intervalHours = input.intervalHours ?? SOCIAL_LIMITS.defaultIntervalHours;
  if (intervalHours < SOCIAL_LIMITS.minIntervalHours)
    throw localizedError("validation", "social.errors.intervalTooShort", {
      hours: SOCIAL_LIMITS.minIntervalHours,
    });

  const existing = await deps.db
    .select({ id: socialProfiles.id, handle: socialProfiles.handle })
    .from(socialProfiles)
    .where(eq(socialProfiles.clientId, input.clientId));
  if (existing.some((p) => p.handle === handle))
    throw localizedError("conflict", "social.errors.duplicateProfile", { handle });
  if (existing.length >= SOCIAL_LIMITS.maxProfilesPerClient)
    throw localizedError("validation", "social.errors.tooManyProfiles", {
      max: SOCIAL_LIMITS.maxProfilesPerClient,
    });

  const [row] = await deps.db
    .insert(socialProfiles)
    .values({
      clientId: input.clientId,
      handle,
      role: input.role ?? "competitor",
      auditId: input.auditId ?? null,
      monitored: input.monitored ?? false,
      intervalHours,
      nextRunAt: input.monitored ? new Date() : null,
      createdBy: userIdOf(actor),
    })
    .returning()
    .catch((err: unknown) => {
      // Two people adding the same profile at once: the unique index decides.
      const e = err as { code?: string; cause?: { code?: string } } | null;
      if (e?.code === "23505" || e?.cause?.code === "23505")
        throw localizedError("conflict", "social.errors.duplicateProfile", { handle });
      throw err;
    });
  await recordAuditEvent(deps.db, {
    actor,
    action: "social.profile.add",
    entity: "social_profile",
    entityId: row!.id,
    clientId: input.clientId,
    meta: { handle, role: row!.role },
  });
  if (input.readNow && deps.queues) await requestSnapshot(deps, actor, row!.id);
  return row!;
}

export async function updateProfile(
  deps: SocialServiceDeps,
  actor: Actor,
  input: {
    profileId: string;
    role?: SocialProfileRole;
    monitored?: boolean;
    intervalHours?: number;
  },
): Promise<void> {
  const profile = await editableProfile(deps.db, actor, input.profileId);
  if (input.intervalHours !== undefined && input.intervalHours < SOCIAL_LIMITS.minIntervalHours)
    throw localizedError("validation", "social.errors.intervalTooShort", {
      hours: SOCIAL_LIMITS.minIntervalHours,
    });
  const turningOn = input.monitored === true && !profile.monitored;
  await deps.db
    .update(socialProfiles)
    .set({
      ...(input.role ? { role: input.role } : {}),
      ...(input.monitored !== undefined ? { monitored: input.monitored } : {}),
      ...(input.intervalHours !== undefined ? { intervalHours: input.intervalHours } : {}),
      ...(input.monitored === false ? { nextRunAt: null } : {}),
      ...(turningOn ? { nextRunAt: new Date() } : {}),
    })
    .where(eq(socialProfiles.id, profile.id));
  await recordAuditEvent(deps.db, {
    actor,
    action: "social.profile.update",
    entity: "social_profile",
    entityId: profile.id,
    clientId: profile.clientId,
    meta: {
      ...(input.role ? { role: input.role } : {}),
      ...(input.monitored !== undefined ? { monitored: input.monitored } : {}),
      ...(input.intervalHours !== undefined ? { intervalHours: input.intervalHours } : {}),
    },
  });
}

export async function removeProfile(
  deps: SocialServiceDeps,
  actor: Actor,
  profileId: string,
): Promise<void> {
  const profile = await editableProfile(deps.db, actor, profileId);
  await deps.db.transaction(async (tx) => {
    await tx.delete(socialProfiles).where(eq(socialProfiles.id, profile.id));
    await recordAuditEvent(tx, {
      actor,
      action: "social.profile.remove",
      entity: "social_profile",
      entityId: profile.id,
      clientId: profile.clientId,
      meta: { handle: profile.handle },
    });
  });
}

/** Put a paused or failed profile back in line for the next read. */
export async function resumeProfile(
  deps: SocialServiceDeps,
  actor: Actor,
  profileId: string,
): Promise<void> {
  const profile = await editableProfile(deps.db, actor, profileId);
  await deps.db
    .update(socialProfiles)
    .set({
      status: "pending",
      statusReason: null,
      nextRunAt: profile.monitored ? new Date() : null,
    })
    .where(eq(socialProfiles.id, profile.id));
}

/**
 * An Admin lets a source read again after Instagram asked for a login or a check. Every profile
 * that was stopped by it goes back to pending.
 */
export async function resumeSource(
  deps: SocialServiceDeps,
  actor: Actor,
  source: LiveSource,
): Promise<void> {
  assertCan(actor, "settings.manage");
  await clearSourceBlocked(deps.db, source, userIdOf(actor));
  await deps.db
    .update(socialProfiles)
    .set({
      status: "pending",
      statusReason: null,
      nextRunAt: sql`case when ${socialProfiles.monitored} then now() else null end`,
    })
    .where(eq(socialProfiles.status, "blocked"));
  await recordAuditEvent(deps.db, {
    actor,
    action: "social.source.resume",
    entity: "social_source",
    meta: { source },
  });
}
