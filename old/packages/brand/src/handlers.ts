/**
 * Worker handlers of the Brand Identity module. The worker spreads `brandHandlers`
 * into its handler map; dependencies are built from the environment on first use.
 */
import {
  createAiGateway,
  createDbLedger,
  createProvidersFromEnv,
  resolveAiEnv,
  settingsRouting,
  type AiGateway,
} from "@forgecy/ai";
import { loadEnv } from "@forgecy/core";
import { createStorageFromEnv, type StorageDriver } from "@forgecy/files";
import { handle, type JobHandlers } from "@forgecy/jobs";
import type { Database } from "@forgecy/db";
import { brandCrawlWebsiteJob, brandImportSourceJob } from "./jobs";
import { runSourceImport } from "./import/run";
import { runWebsiteCrawl } from "./crawl";

interface Deps {
  storage: StorageDriver;
  ai: AiGateway | null;
}

let deps: Deps | undefined;

async function depsFor(
  db: Database,
  logger: { warn(obj: Record<string, unknown>, msg?: string): void },
): Promise<Deps> {
  if (deps) return deps;
  const env = await resolveAiEnv(db, loadEnv());
  const providers = createProvidersFromEnv(env);
  const hasText = Object.keys(providers.text).length > 0;
  deps = {
    storage: createStorageFromEnv(env),
    ai: hasText
      ? createAiGateway({
          ledger: createDbLedger(db),
          providers,
          routing: settingsRouting(db, env, providers),
          logger,
        })
      : null,
  };
  return deps;
}

export const brandHandlers: JobHandlers = {
  ...handle(brandImportSourceJob, async (payload, ctx) => {
    const d = await depsFor(ctx.db, ctx.logger);
    const result = await runSourceImport(
      { db: ctx.db, storage: d.storage, ai: d.ai },
      {
        jobId: ctx.jobId,
        attempt: ctx.attempt,
        maxAttempts: ctx.maxAttempts,
        requestedBy: payload.requestedBy ?? null,
        progress: ctx.progress,
      },
      {
        clientId: payload.clientId,
        sourceId: payload.sourceId,
        language: payload.language,
        // Only website and social sources apply themselves; documents keep the review queue.
        autoApply: true,
      },
    );
    return { ...result };
  }),
  ...handle(brandCrawlWebsiteJob, async (payload, ctx) => {
    const d = await depsFor(ctx.db, ctx.logger);
    const result = await runWebsiteCrawl(
      { db: ctx.db, storage: d.storage, ai: d.ai },
      {
        jobId: ctx.jobId,
        attempt: ctx.attempt,
        maxAttempts: ctx.maxAttempts,
        requestedBy: payload.requestedBy ?? null,
        progress: ctx.progress,
      },
      { clientId: payload.clientId, sourceId: payload.sourceId, language: payload.language },
    );
    return { ...result };
  }),
};
