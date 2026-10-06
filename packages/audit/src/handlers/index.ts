import {
  createAiGateway,
  createDbLedger,
  createProvidersFromEnv,
  defaultRoutingFromEnv,
} from "@forgecy/ai";
import { loadEnv } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { createQueues, handle, type JobHandlers } from "@forgecy/jobs";
import { createBrowserFetcher, resolveChromiumPath } from "../crawl/browser";
import { auditUserAgent } from "../crawl/fetcher";
import {
  auditAnalyzeSiteJob,
  auditAnalyzeSocialJob,
  auditCompareChannelsJob,
  auditCompareCompetitorsJob,
  auditCrawlJob,
  auditDiagnoseJob,
  auditPlanJob,
  auditProposeCompetitorsJob,
} from "../jobs";
import { createHostCheck } from "../url";
import {
  runAnalyzeSite,
  runAnalyzeSocial,
  runCompareChannels,
  runCompareCompetitors,
  runDiagnose,
  runPlan,
  runProposeCompetitors,
} from "./analysis";
import type { AuditHandlerDeps } from "./context";
import { runCrawl } from "./crawl";

export type { AuditHandlerDeps } from "./context";

/** Deps from the environment: DB, storage, a producer for follow-up jobs, the AI gateway. */
export async function auditDepsFromEnv(): Promise<AuditHandlerDeps> {
  const env = loadEnv();
  const db = getDb();
  const providers = createProvidersFromEnv(env);
  const userAgent = auditUserAgent();
  const hostCheck = createHostCheck({
    allowPrivate: process.env.FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS === "true",
  });
  const executablePath = resolveChromiumPath();
  return {
    db,
    storage: createStorageFromEnv(env),
    queues: await createQueues(env.REDIS_URL),
    gateway: createAiGateway({
      ledger: createDbLedger(db),
      providers,
      routing: defaultRoutingFromEnv(env, providers),
    }),
    hostCheck,
    userAgent,
    createFetcher: () =>
      createBrowserFetcher({
        userAgent,
        hostCheck,
        ...(executablePath ? { executablePath } : {}),
      }),
  };
}

/**
 * Worker handlers of the audit module. Deps are created on the first audit job, so
 * the worker starts even when storage or AI settings are only needed later.
 */
export function createAuditHandlers(
  getDeps: () => Promise<AuditHandlerDeps> = auditDepsFromEnv,
): JobHandlers {
  let deps: Promise<AuditHandlerDeps> | undefined;
  const d = () => {
    deps ??= getDeps().catch((err: unknown) => {
      deps = undefined;
      throw err;
    });
    return deps;
  };
  return {
    ...handle(auditCrawlJob, async (p, ctx) => runCrawl(await d(), p, ctx)),
    ...handle(auditAnalyzeSiteJob, async (p, ctx) => runAnalyzeSite(await d(), p, ctx)),
    ...handle(auditAnalyzeSocialJob, async (p, ctx) => runAnalyzeSocial(await d(), p, ctx)),
    ...handle(auditProposeCompetitorsJob, async (p, ctx) =>
      runProposeCompetitors(await d(), p, ctx),
    ),
    ...handle(auditCompareCompetitorsJob, async (p, ctx) =>
      runCompareCompetitors(await d(), p, ctx),
    ),
    ...handle(auditCompareChannelsJob, async (p, ctx) => runCompareChannels(await d(), p, ctx)),
    ...handle(auditDiagnoseJob, async (p, ctx) => runDiagnose(await d(), p, ctx)),
    ...handle(auditPlanJob, async (p, ctx) => runPlan(await d(), p, ctx)),
  };
}
