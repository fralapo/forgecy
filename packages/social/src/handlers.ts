import { loadEnv } from "@forgecy/core";
import { getDb, userActor } from "@forgecy/db";
import { messageRef } from "@forgecy/i18n";
import { handle, NeedsAttentionError, type JobHandlers } from "@forgecy/jobs";
import { socialSnapshotJob } from "./jobs";
import { importProfileToAudit } from "./service/audit-bridge";
import { createSocialRuntime, type SocialRuntime } from "./service/runtime";
import { runSnapshot } from "./service/snapshot";

/** The runtime keeps pacing windows and breakers, so one lives for the whole worker. */
async function defaultRuntime(): Promise<SocialRuntime> {
  const env = loadEnv();
  // Imported here so only the worker, when it first reads a profile, loads Playwright.
  const { createChromiumLauncher } = await import("./sources/public-browser-driver");
  return createSocialRuntime(env, {
    launcher: createChromiumLauncher(
      env.FORGECY_CHROMIUM_PATH ? { executablePath: env.FORGECY_CHROMIUM_PATH } : {},
    ),
  });
}

export function createSocialHandlers(
  getRuntime: () => SocialRuntime | Promise<SocialRuntime> = defaultRuntime,
): JobHandlers {
  let runtime: Promise<SocialRuntime> | undefined;
  const rt = () => (runtime ??= Promise.resolve(getRuntime()));
  return {
    ...handle(socialSnapshotJob, async (payload, ctx) => {
      const db = getDb();
      const outcome = await runSnapshot({ db, runtime: await rt() }, payload.profileId);
      await ctx.progress(100);
      if (!outcome) return { skipped: true };
      // A challenge needs a person: no retries, the job ends in "Needs attention".
      if (outcome.status === "blocked")
        throw new NeedsAttentionError(
          "Instagram asked for a login or a check",
          { source: outcome.source },
          messageRef("social.status.blocked"),
        );
      // Started from an audit: the person who clicked "Read profile" gets the numbers in the audit,
      // within what they can reach today.
      if (outcome.status === "ok" && payload.auditId && ctx.row.createdBy) {
        const actor = await userActor(db, ctx.row.createdBy);
        if (actor)
          await importProfileToAudit(db, actor, {
            auditId: payload.auditId,
            profileId: payload.profileId,
          });
      }
      return outcome;
    }),
  };
}
