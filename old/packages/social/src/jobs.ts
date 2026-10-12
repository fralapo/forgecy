import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/**
 * Read one Instagram profile from the best configured source and keep what changed.
 * With `auditId`, the result also fills that audit's Instagram channel.
 */
export const socialSnapshotJob = defineJob({
  kind: "social.snapshot",
  queue: "default",
  payload: z.object({ profileId: z.uuid(), auditId: z.uuid().optional() }),
});

export const socialJobs = [socialSnapshotJob] as const;

/** jobs.entity of social jobs; jobs.entity_id is the social profile id. */
export const SOCIAL_JOB_ENTITY = "social_profile";
