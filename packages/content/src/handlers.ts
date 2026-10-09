/**
 * Worker handlers of the content module: `...contentHandlers` in apps/worker.
 * Dependencies (storage, AI gateway, image route) are built from the environment
 * on first use; exports go through the carousel module's own export handler.
 */
import {
  createAiGateway,
  createDbLedger,
  createMcpImageProviders,
  createProvidersFromEnv,
  createRoutingSource,
  resolveAiEnv,
} from "@forgecy/ai";
import { carouselExportPayloadSchema } from "@forgecy/carousel";
import { carouselWorkerHandlers } from "@forgecy/carousel/export";
import { DEFAULT_LOCALE, isLocale, loadEnv, type Actor } from "@forgecy/core";
import { and, contentApprovals, contentVersions, desc, eq, type Database } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { englishMessage, messageRef, type MessageKey } from "@forgecy/i18n";
import { handle, NeedsAttentionError, type JobContext, type JobHandlers } from "@forgecy/jobs";
import { requireClient } from "./access";
import { getContentRow, isFinalExportable, recordExport } from "./carousels/carousels";
import { parseDocument, toRenderSlide } from "./document";
import {
  creativeDirectionJob,
  editSlideJob,
  exportContentJob,
  generateImageJob,
  generateOutlineJob,
  generateSlidesJob,
  proposePlanJob,
  proposeStrategyJob,
} from "./jobs";
import {
  runCreativeDirection,
  runEditSlide,
  runGenerateImage,
  runGenerateOutline,
  runGenerateSlides,
  runProposePlan,
  runProposeStrategy,
  type PipelineContext,
  type PipelineDeps,
} from "./ai/pipeline";
import { loadBrand } from "./carousels/theme";
import { registerContentPorts } from "./wiring";

const attention = (key: Extract<MessageKey, `content.jobErrors.${string}`>) =>
  new NeedsAttentionError(englishMessage(key), undefined, messageRef(key));

registerContentPorts();

let deps: Omit<PipelineDeps, "db"> | undefined;

/** Pipeline dependencies built from the environment; also used by batch automations. */
export async function pipelineDepsFor(
  db: Database,
  logger: JobContext["logger"],
): Promise<PipelineDeps> {
  if (!deps) {
    const env = await resolveAiEnv(db, loadEnv());
    const providers = createProvidersFromEnv(env);
    // Subscriptions over MCP (Higgsfield) are routed only while connected.
    const mcp = createMcpImageProviders(db, env);
    providers.image = { ...providers.image, ...mcp };
    // Services and models follow the Admin's choice in Settings > AI providers, read per job.
    const source = createRoutingSource(db, env, providers);
    const hasProvider =
      Object.keys(providers.text).length > 0 || Object.keys(providers.image).length > 0;
    deps = {
      storage: createStorageFromEnv(env),
      ai: hasProvider
        ? createAiGateway({
            ledger: createDbLedger(db),
            providers,
            routing: async () => (await source()).routing,
            logger,
          })
        : null,
      resolveImageRoute: async () => (await source()).images,
    };
  }
  return { ...deps, db };
}

const pctx = (ctx: JobContext, requestedBy: string | null | undefined): PipelineContext => ({
  jobId: ctx.jobId,
  requestedBy: requestedBy ?? null,
  progress: (p) => ctx.progress(p),
});

let carouselExport: ReturnType<typeof carouselWorkerHandlers>["carousel.export"] | undefined;

/** The export as the carousel module defines it, with the content's frozen inputs. */
async function runExport(
  payload: ReturnType<typeof exportContentJob.payload.parse>,
  ctx: JobContext,
) {
  const db = ctx.db;
  const system: Actor = { type: "agent", role: "reviewer", runId: ctx.jobId };
  const client = await requireClient(db, payload.clientId);
  const c = await getContentRow(db, payload.clientId, payload.contentId);
  const [version] = await db
    .select()
    .from(contentVersions)
    .where(and(eq(contentVersions.id, payload.versionId), eq(contentVersions.contentId, c.id)));
  if (!version) throw attention("content.jobErrors.versionNotFound");
  // The gate was checked when the export was requested; the carousel may have been edited since.
  if (!payload.draft && !isFinalExportable(c)) throw attention("content.jobErrors.notApproved");
  if (!payload.draft && c.approvedVersionId !== version.id)
    throw attention("content.jobErrors.notApprovedVersion");
  const doc = parseDocument(version.document);
  const brand = await loadBrand(db, system, {
    clientId: c.clientId,
    clientName: client.name,
    versionId: version.brandVersionId ?? c.brandVersionId,
  });
  if (!brand) throw attention("content.jobErrors.brandVersionUnavailable");
  const meta = version.meta as { templateVersion?: string | null; models?: string[] };
  const [approval] = payload.draft
    ? []
    : await db
        .select({ at: contentApprovals.decidedAt })
        .from(contentApprovals)
        .where(
          and(
            eq(contentApprovals.versionId, version.id),
            eq(contentApprovals.decision, "approved"),
          ),
        )
        .orderBy(desc(contentApprovals.decidedAt))
        .limit(1);
  const exportPayload = carouselExportPayloadSchema.parse({
    clientId: c.clientId,
    client: client.name,
    content: c.title,
    version: version.number,
    templateId: c.templateKey,
    ...((meta.templateVersion ?? c.templateVersion)
      ? { templateVersion: meta.templateVersion ?? c.templateVersion }
      : {}),
    slides: doc.slides.map(toRenderSlide),
    brand: brand.theme,
    caption: doc.caption,
    hashtags: doc.hashtags,
    outputs: payload.outputs,
    draft: payload.draft,
    language: isLocale(c.language) ? c.language : DEFAULT_LOCALE,
    metadata: {
      brandIdentityVersion: `v${brand.identity.number}`,
      ...(meta.models?.length ? { models: meta.models.slice(0, 10) } : {}),
      ...(approval ? { approvedAt: approval.at.toISOString() } : {}),
    },
  });
  carouselExport ??= carouselWorkerHandlers()["carousel.export"];
  const result = (await carouselExport(exportPayload, ctx)) as {
    files: Record<string, unknown>[];
    issues: unknown[];
    warnings: string[];
  };
  const row = await recordExport(db, {
    contentId: c.id,
    versionId: version.id,
    jobId: ctx.jobId,
    draft: payload.draft,
    outputs: payload.outputs,
    files: result.files,
    requestedBy: payload.requestedBy ?? null,
  });
  return {
    exportId: row.id,
    files: result.files,
    issues: result.issues,
    warnings: result.warnings,
  };
}

export const contentHandlers: JobHandlers = {
  ...handle(proposeStrategyJob, async (p, ctx) =>
    runProposeStrategy(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(proposePlanJob, async (p, ctx) =>
    runProposePlan(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(creativeDirectionJob, async (p, ctx) =>
    runCreativeDirection(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateOutlineJob, async (p, ctx) =>
    runGenerateOutline(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateSlidesJob, async (p, ctx) =>
    runGenerateSlides(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(editSlideJob, async (p, ctx) =>
    runEditSlide(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateImageJob, async (p, ctx) =>
    runGenerateImage(await pipelineDepsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(exportContentJob, (p, ctx) => runExport(p, ctx)),
};
