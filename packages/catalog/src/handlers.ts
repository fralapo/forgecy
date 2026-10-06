import {
  createAiGateway,
  createDbLedger,
  createProvidersFromEnv,
  settingsRouting,
} from "@forgecy/ai";
import { loadEnv } from "@forgecy/core";
import { and, eq, inArray, productImports } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import {
  handle,
  isNeedsAttentionError,
  isUnrecoverableError,
  type JobContext,
} from "@forgecy/jobs";
import { isImportError } from "./import/errors";
import { catalogImportJob, type ImportPhase } from "./import/jobs";
import { runImportPhase, type PipelineDeps } from "./import/pipeline";

const stepLabels: Record<ImportPhase, string> = {
  scan: "Reading the files",
  extract: "Extracting the products",
};

/** Dependencies built from the environment (worker process). */
export function catalogDepsFromEnv(ctx: Pick<JobContext, "db" | "logger">): PipelineDeps {
  const env = loadEnv();
  const providers = createProvidersFromEnv(env);
  const hasText = Object.keys(providers.text).length > 0;
  return {
    db: ctx.db,
    storage: createStorageFromEnv(env),
    ai: hasText
      ? createAiGateway({
          ledger: createDbLedger(ctx.db),
          providers,
          routing: settingsRouting(ctx.db, env, providers),
          logger: ctx.logger,
        })
      : null,
    localModelConfigured: env.LOCAL_LLM_ENABLED,
    logger: ctx.logger,
  };
}

/** Worker handlers of the catalog: `...catalogHandlers` in apps/worker/src/handlers.ts. */
export function createCatalogHandlers(
  depsFor: (ctx: JobContext) => PipelineDeps = catalogDepsFromEnv,
) {
  return handle(catalogImportJob, async (payload, ctx) => {
    try {
      const result = await runImportPhase(depsFor(ctx), payload.importId, payload.phase, {
        jobId: ctx.jobId,
        progress: (p) => ctx.progress(p),
        heartbeat: () => ctx.heartbeat(),
        isCancelled: () => ctx.isCancelled(),
      });
      return result as Record<string, unknown>;
    } catch (err) {
      const final =
        isImportError(err) ||
        isNeedsAttentionError(err) ||
        isUnrecoverableError(err) ||
        ctx.attempt >= ctx.maxAttempts;
      if (final) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.db
          .update(productImports)
          .set({
            status: "failed",
            errorCode: isImportError(err) ? err.code : "IMPORT-FAILED",
            error: `Import failed at step "${stepLabels[payload.phase]}". ${message}`.slice(
              0,
              1000,
            ),
            failedStep: payload.phase,
          })
          .where(
            and(
              eq(productImports.id, payload.importId),
              inArray(productImports.status, ["analyzing"]),
            ),
          );
      }
      throw err;
    }
  });
}

export const catalogHandlers = createCatalogHandlers();
