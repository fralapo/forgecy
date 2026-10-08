import {
  createAiGateway,
  createDbLedger,
  createProvidersFromEnv,
  resolveAiEnv,
  settingsRouting,
} from "@forgecy/ai";
import { loadEnv } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { sharedRenderBrowser } from "@forgecy/carousel/export";
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
  auditReportExportJob,
  auditReportTextsJob,
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
import { runReportTexts } from "./report";
import { runReportExport } from "./report-export";

export type { AuditHandlerDeps } from "./context";

/** Deps from the environment: DB, storage, a producer for follow-up jobs, the AI gateway. */
export async function auditDepsFromEnv(): Promise<AuditHandlerDeps> {
  const db = getDb();
  const env = await resolveAiEnv(db, loadEnv());
  const providers = createProvidersFromEnv(env);
  const userAgent = auditUserAgent();
  const allowPrivate = env.FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS;
  const hostCheck = createHostCheck({ allowPrivate });
  const executablePath = resolveChromiumPath();
  return {
    db,
    storage: createStorageFromEnv(env),
    queues: await createQueues(env.REDIS_URL),
    gateway: createAiGateway({
      ledger: createDbLedger(db),
      providers,
      routing: settingsRouting(db, env, providers),
    }),
    hostCheck,
    allowPrivate,
    userAgent,
    createFetcher: (rootUrl) =>
      createBrowserFetcher({
        userAgent,
        hostCheck,
        rootUrl,
        allowPrivate,
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
  // Report PDFs use the renderer's own Chromium (fixed raster flags), started on first use.
  const renderBrowser = sharedRenderBrowser();
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
    ...handle(auditReportTextsJob, async (p, ctx) => runReportTexts(await d(), p, ctx)),
    ...handle(auditReportExportJob, async (p, ctx) =>
      runReportExport({ ...(await d()), renderBrowser: () => renderBrowser.get() }, p, ctx),
    ),
  };
}
