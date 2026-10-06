import { createAuditHandlers } from "@forgecy/audit/handlers";
import { automationHandlers } from "@forgecy/automations/handlers";
import { backupHandlers } from "@forgecy/backup";
import { clientTransferHandlers } from "@forgecy/client-transfer/handlers";
import { loadEnv } from "@forgecy/core";
import { resolveMediaRoot } from "@forgecy/files";
import { carouselWorkerHandlers } from "@forgecy/carousel/export";
import { brandHandlers } from "@forgecy/brand/handlers";
import { brandBookHandlers } from "@forgecy/brand-book/handlers";
import { contentHandlers } from "@forgecy/content/handlers";
import { catalogHandlers } from "@forgecy/catalog/handlers";
import { handle, systemPingJob, type JobHandlers } from "@forgecy/jobs";
import pkg from "../package.json" with { type: "json" };

/**
 * Every job the worker runs. Module threads add their handlers here, one spread per
 * module (e.g. `...auditHandlers`), keeping the handler code in their own package.
 */
const env = loadEnv();

export const handlers: JobHandlers = {
  ...createAuditHandlers(),
  ...handle(systemPingJob, async (payload, ctx) => {
    await ctx.progress(100);
    return { pong: payload.message, at: new Date().toISOString() };
  }),
  ...carouselWorkerHandlers(),
  ...brandHandlers,
  ...brandBookHandlers(),
  ...contentHandlers,
  ...automationHandlers(),
  ...clientTransferHandlers(),
  ...catalogHandlers,
  ...backupHandlers({
    dataDir: resolveMediaRoot(env.FORGECY_DATA_DIR),
    mediaDir: resolveMediaRoot(env.MEDIA_ROOT),
    databaseUrl: env.DATABASE_URL,
    appVersion: pkg.version,
  }),
};
