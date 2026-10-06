import { carouselWorkerHandlers } from "@forgecy/carousel/export";
import { brandHandlers } from "@forgecy/brand/handlers";
import { catalogHandlers } from "@forgecy/catalog/handlers";
import { handle, systemPingJob, type JobHandlers } from "@forgecy/jobs";

/**
 * Every job the worker runs. Module threads add their handlers here, one spread per
 * module (e.g. `...auditHandlers`), keeping the handler code in their own package.
 */
export const handlers: JobHandlers = {
  ...handle(systemPingJob, async (payload, ctx) => {
    await ctx.progress(100);
    return { pong: payload.message, at: new Date().toISOString() };
  }),
  ...carouselWorkerHandlers(),
  ...brandHandlers,
  ...catalogHandlers,
};
