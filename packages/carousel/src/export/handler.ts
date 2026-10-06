import { ForgecyError, loadEnv } from "@forgecy/core";
import { type StorageDriver, contentKey, createStorageFromEnv, sha256 } from "@forgecy/files";
import { type JobContext, NeedsAttentionError, UnrecoverableError, handle } from "@forgecy/jobs";
import type { Browser } from "playwright-core";
import {
  dbTemplateSource,
  getTemplateRow,
  loadTemplatePackage,
  saveTemplateValidation,
} from "../catalog";
import type { TemplateSource } from "../node";
import {
  type CarouselExportPayload,
  type ExportedFile,
  carouselExportJob,
  templateValidateJob,
} from "../jobs";
import { buildCarouselSchema } from "../slide-schema";
import { validateTemplatePackage } from "../validate";
import { collectAssetKeys, resolveAssets } from "../assets";
import { sharedRenderBrowser } from "./browser";
import { ExportCancelledError, exportCarousel } from "./carousel";
import { renderCheckTemplate } from "./template-check";

export interface CarouselHandlerDeps {
  storage: StorageDriver;
  /** Defaults to the published catalog in the database. */
  templates?: TemplateSource;
  browser: () => Promise<Browser>;
}

async function runExport(deps: CarouselHandlerDeps, p: CarouselExportPayload, ctx: JobContext) {
  const source = deps.templates ?? dbTemplateSource({ db: ctx.db, storage: deps.storage });
  const pkg = await source.get(p.templateId, p.templateVersion);
  if (!pkg)
    throw new NeedsAttentionError(
      `Template ${p.templateId}${p.templateVersion ? ` v${p.templateVersion}` : ""} not found`,
    );
  const check = buildCarouselSchema(pkg.manifest).safeParse(p.slides);
  if (!check.success)
    throw new NeedsAttentionError(
      `Slides not valid for the template: ${check.error.issues[0]?.message ?? "error"}`,
      {
        issues: check.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    );

  let assets: Map<string, string>;
  try {
    assets = await resolveAssets(deps.storage, p.clientId, collectAssetKeys(check.data, p.brand));
  } catch (err) {
    if (err instanceof ForgecyError) throw new NeedsAttentionError(err.message);
    throw err;
  }

  let result;
  try {
    result = await exportCarousel(await deps.browser(), {
      pkg,
      slides: check.data,
      brand: p.brand,
      assets,
      outputs: p.outputs,
      draft: p.draft,
      language: p.language,
      meta: { client: p.client, content: p.content, version: p.version, ...p.metadata },
      texts: { caption: p.caption, hashtags: p.hashtags },
      onProgress: (percent) => ctx.progress(percent),
      isCancelled: () => ctx.isCancelled(),
    });
  } catch (err) {
    if (err instanceof ExportCancelledError) throw new UnrecoverableError(err.message);
    throw err;
  }

  const files: ExportedFile[] = [];
  for (const f of result.files) {
    const hash = sha256(f.data);
    const key = contentKey({ clientId: p.clientId, scope: "exports", sha256: hash, ext: f.kind });
    // Content-addressed: re-exporting the same version writes nothing new.
    if (!(await deps.storage.exists(key)))
      await deps.storage.put(key, f.data, {
        contentType: f.contentType,
        contentLength: f.data.length,
      });
    files.push({
      name: f.name,
      key,
      contentType: f.contentType,
      size: f.data.length,
      sha256: hash,
      kind: f.kind,
    });
    await ctx.heartbeat();
  }
  return {
    files,
    issues: result.issues,
    warnings: result.warnings,
    template: { id: pkg.manifest.id, version: pkg.manifest.version, format: pkg.manifest.format },
    slides: p.slides.length,
  };
}

/** Worker handlers of the carousel module: `...carouselHandlers(deps)` in apps/worker. */
export function carouselHandlers(deps: CarouselHandlerDeps) {
  return {
    ...handle(carouselExportJob, (payload, ctx) => runExport(deps, payload, ctx)),
    ...handle(templateValidateJob, async (payload, ctx) => {
      const row = await getTemplateRow(ctx.db, payload.templateRowId);
      if (!row) throw new NeedsAttentionError("Template not found");
      const pkg = await loadTemplatePackage(deps.storage, row);
      const report = validateTemplatePackage(pkg.files);
      await ctx.progress(30);
      const full = report.ok
        ? await renderCheckTemplate(await deps.browser(), pkg, report)
        : report;
      await saveTemplateValidation(ctx.db, row.id, full);
      return { ok: full.ok, checks: full.checks, issues: full.issues.length };
    }),
  };
}

/** Handlers wired from the environment: storage driver, repository templates, one shared Chromium. */
export function carouselWorkerHandlers() {
  const browser = sharedRenderBrowser();
  return carouselHandlers({
    storage: createStorageFromEnv(loadEnv()),
    browser: () => browser.get(),
  });
}
