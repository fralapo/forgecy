import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  jobs,
  lte,
  or,
  socialProfiles,
  type Database,
} from "@forgecy/db";
import { enqueueJob, type JobQueues } from "@forgecy/jobs";
import { SOCIAL_JOB_ENTITY, socialSnapshotJob } from "../jobs";
import { blockedSources } from "./state";
import type { SocialRuntime } from "./runtime";

/** Profiles read in one tick at most. */
const MAX_PER_TICK = 10;
/** Spread of the reads inside a tick, so they never leave in a burst. */
const STAGGER_MS = 45_000;

/**
 * Called by the worker every few minutes: queues a read for every monitored profile that is due,
 * staggered. A profile whose source is stopped, or that has no source at all, is skipped.
 * Returns the number of reads queued.
 */
export async function enqueueDueSnapshots(
  db: Database,
  queues: JobQueues,
  runtime: SocialRuntime,
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<number> {
  const available = runtime.available();
  if (!available.length) return 0;
  const blocked = await blockedSources(db);
  if (available.every((s) => blocked[s])) return 0;

  const due = await db
    .select()
    .from(socialProfiles)
    .where(
      and(
        eq(socialProfiles.monitored, true),
        inArray(socialProfiles.status, ["pending", "ok", "error"]),
        or(isNull(socialProfiles.nextRunAt), lte(socialProfiles.nextRunAt, now)),
      ),
    )
    .orderBy(asc(socialProfiles.nextRunAt))
    .limit(MAX_PER_TICK);

  let queued = 0;
  for (const profile of due) {
    const [active] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.entity, SOCIAL_JOB_ENTITY),
          eq(jobs.entityId, profile.id),
          eq(jobs.kind, socialSnapshotJob.kind),
          inArray(jobs.status, ["queued", "retrying", "running"]),
        ),
      )
      .limit(1);
    if (active) continue;
    await enqueueJob(db, queues, {
      kind: socialSnapshotJob,
      payload: { profileId: profile.id },
      clientId: profile.clientId,
      entity: SOCIAL_JOB_ENTITY,
      entityId: profile.id,
      createdBy: profile.createdBy,
      delayMs: queued * STAGGER_MS + Math.round(random() * STAGGER_MS),
    });
    // Until the read finishes and sets the real next time, do not come due again.
    await db
      .update(socialProfiles)
      .set({ nextRunAt: new Date(now.getTime() + 60 * 60_000) })
      .where(eq(socialProfiles.id, profile.id));
    queued++;
  }
  return queued;
}
