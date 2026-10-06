/**
 * Worker handlers of the content module: `...contentHandlers` in apps/worker.
 * Dependencies (storage, AI gateway, image route) are built from the environment
 * on first use; exports go through the carousel module's own export handler.
 */
import {
  createAiGateway,
  createDbLedger,
  createProvidersFromEnv,
  defaultRoutingFromEnv,
  type ModelRef,
} from "@forgecy/ai";
import { carouselExportPayloadSchema } from "@forgecy/carousel";
import { carouselWorkerHandlers } from "@forgecy/carousel/export";
import { loadEnv, type Actor } from "@forgecy/core";
import { and, contentApprovals, contentVersions, desc, eq, type Database } from "@forgecy/db";
import { createStorageFromEnv } from "@forgecy/files";
import { handle, NeedsAttentionError, type JobContext, type JobHandlers } from "@forgecy/jobs";
import { requireClient } from "./access";
import { getContentRow, recordExport } from "./carousels";
import { parseDocument, toRenderSlide } from "./document";
import {
  editSlideJob,
  exportContentJob,
  generateImageJob,
  generateOutlineJob,
  generateSlidesJob,
  proposePlanJob,
  proposeStrategyJob,
} from "./jobs";
import {
  runEditSlide,
  runGenerateImage,
  runGenerateOutline,
  runGenerateSlides,
  runProposePlan,
  runProposeStrategy,
  type PipelineContext,
  type PipelineDeps,
} from "./pipeline";
import { loadBrand } from "./theme";

let deps: Omit<PipelineDeps, "db"> | undefined;

function depsFor(db: Database, logger: JobContext["logger"]): PipelineDeps {
  if (!deps) {
    const env = loadEnv();
    const providers = createProvidersFromEnv(env);
    const routing = defaultRoutingFromEnv(env, providers);
    const hasText = Object.keys(providers.text).length > 0;
    const imageRoute: ModelRef[] = routing.image
      ? [routing.image.primary, ...(routing.image.fallback ? [routing.image.fallback] : [])]
      : [];
    deps = {
      storage: createStorageFromEnv(env),
      ai:
        hasText || imageRoute.length
          ? createAiGateway({ ledger: createDbLedger(db), providers, routing, logger })
          : null,
      imageRoute,
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
  if (!version) throw new NeedsAttentionError("Versione del carosello non trovata");
  if (!payload.draft && c.approvedVersionId !== version.id)
    throw new NeedsAttentionError("La versione non è quella approvata");
  const doc = parseDocument(version.document);
  if (doc.caption.length > 2200)
    throw new NeedsAttentionError(
      "La didascalia supera i 2.200 caratteri: l'export del renderer non la accetta ancora. Accorciala o esporta senza didascalia.",
    );
  const brand = await loadBrand(db, system, {
    clientId: c.clientId,
    clientName: client.name,
    versionId: version.brandVersionId ?? c.brandVersionId,
  });
  if (!brand) throw new NeedsAttentionError("Versione della Brand Identity non disponibile");
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
  ...handle(proposeStrategyJob, (p, ctx) =>
    runProposeStrategy(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(proposePlanJob, (p, ctx) =>
    runProposePlan(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateOutlineJob, (p, ctx) =>
    runGenerateOutline(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateSlidesJob, (p, ctx) =>
    runGenerateSlides(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(editSlideJob, (p, ctx) =>
    runEditSlide(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(generateImageJob, (p, ctx) =>
    runGenerateImage(depsFor(ctx.db, ctx.logger), pctx(ctx, p.requestedBy), p),
  ),
  ...handle(exportContentJob, (p, ctx) => runExport(p, ctx)),
};
