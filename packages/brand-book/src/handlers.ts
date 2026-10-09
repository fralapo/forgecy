/**
 * Worker handlers of the Brand Book module: the client-facing PDF is rendered with
 * the agency's "Brand Book" template, in the client's colors and fonts (the Brand
 * Identity version the book was built from), by the carousel renderer.
 */
import { buildCarouselSchema } from "@forgecy/carousel";
import { dbTemplateSource } from "@forgecy/carousel/catalog";
import {
  ExportCancelledError,
  exportCarousel,
  sharedRenderBrowser,
} from "@forgecy/carousel/export";
import { loadBrand } from "@forgecy/content";
import { isLocale, loadEnv, type Actor } from "@forgecy/core";
import { appSettings, brandBookExports, clients, eq } from "@forgecy/db";
import { contentKey, createStorageFromEnv, sha256, type StorageDriver } from "@forgecy/files";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import {
  handle,
  NeedsAttentionError,
  UnrecoverableError,
  type JobContext,
  type JobHandlers,
} from "@forgecy/jobs";
import type { Browser } from "playwright-core";
import { bookSlides } from "./book";
import { recordClientBookFile } from "./client-book";
import { brandBookRenderJob } from "./jobs";
import { BRAND_BOOK_TEMPLATE_KEY, bookSections } from "./parts";

const needsAttention = (
  key: MessageKey,
  values?: MessageValues,
  details?: Record<string, unknown>,
) => new NeedsAttentionError(englishMessage(key, values), details, messageRef(key, values));
const unrecoverable = (key: MessageKey) =>
  Object.assign(new UnrecoverableError(englishMessage(key)), { ref: messageRef(key) });

export function brandBookFileName(input: {
  slug: string;
  versionNumber: number;
  number: number;
  final: boolean;
}) {
  const slug = input.slug.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const draft = input.final ? "" : "-draft";
  return `${slug}-brand-book-v${input.versionNumber}-bb${input.number}${draft}.pdf`;
}

export async function runBrandBookRender(
  deps: { storage: StorageDriver; renderBrowser: () => Promise<Browser> },
  payload: { exportId: string; final: boolean },
  ctx: JobContext,
) {
  const { db } = ctx;
  const { storage } = deps;
  const row = await db.query.brandBookExports.findFirst({
    where: eq(brandBookExports.id, payload.exportId),
  });
  if (!row || row.type !== "client_book") throw new UnrecoverableError("Brand Book not found");
  if (payload.final && row.status !== "approved")
    throw unrecoverable("brand.book.jobErrors.noLongerApproved");
  if (!payload.final && row.status !== "draft") return { skipped: true };
  if (!ctx.row.createdBy) throw new UnrecoverableError("Render without a person who requested it");
  const client = await db.query.clients.findFirst({ where: eq(clients.id, row.clientId) });
  if (!client) throw new UnrecoverableError("Client not found");

  // The person who asked for the render; permissions were checked when it was queued.
  const actor: Actor = { type: "user", id: ctx.row.createdBy, isAdmin: false, active: true };
  const brand = await loadBrand(db, actor, {
    clientId: client.id,
    clientName: client.name,
    versionId: row.brandVersionId,
  });
  if (!brand) throw unrecoverable("brand.book.jobErrors.versionMissing");
  const pkg = await dbTemplateSource({ db, storage, clientId: client.id }).get(
    row.templateKey ?? BRAND_BOOK_TEMPLATE_KEY,
    row.templateVersion ?? undefined,
  );
  if (!pkg) throw needsAttention("brand.book.jobErrors.templateMissing");
  await ctx.progress(5);

  const agency = await db.query.appSettings.findFirst({ where: eq(appSettings.key, "agency") });
  const agencyName = (agency?.value as { name?: string } | undefined)?.name?.trim() || null;
  const language = isLocale(row.language) ? row.language : "en";
  let built;
  try {
    built = bookSlides(
      {
        clientName: client.name,
        agencyName,
        versionNumber: row.brandVersionNumber,
        date: new Date(),
        language,
        document: brand.identity.document,
        tokens: brand.identity.tokens,
        colors: brand.theme.colors,
        sections: bookSections.filter((s) => row.parts.includes(s)),
      },
      pkg.manifest,
    );
  } catch (err) {
    throw needsAttention("brand.book.jobErrors.templateUnfit", {
      detail: (err as Error).message,
    });
  }
  const check = buildCarouselSchema(pkg.manifest).safeParse(built.slides);
  if (!check.success)
    throw needsAttention(
      "brand.book.jobErrors.bookUnfit",
      { detail: check.error.issues[0]?.message ?? "error" },
      { issues: check.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    );

  let result;
  try {
    result = await exportCarousel(await deps.renderBrowser(), {
      pkg,
      slides: check.data,
      brand: brand.theme,
      outputs: ["pdf"],
      draft: !payload.final,
      language,
      meta: {
        client: client.name,
        content: "Brand Book",
        version: row.brandVersionNumber,
        ...(row.approvedAt ? { approvedAt: row.approvedAt.toISOString() } : {}),
      },
      onProgress: (percent) => ctx.progress(Math.max(5, Math.min(95, percent))),
      isCancelled: () => ctx.isCancelled(),
    });
  } catch (err) {
    if (err instanceof ExportCancelledError) throw new UnrecoverableError(err.message);
    throw err;
  }
  const pdf = result.files.find((f) => f.kind === "pdf");
  if (!pdf) throw unrecoverable("brand.book.jobErrors.noPdf");

  const key = contentKey({
    clientId: client.id,
    scope: "brand-book",
    sha256: sha256(pdf.data),
    ext: "pdf",
  });
  // Content-addressed: rendering the same book twice writes nothing new.
  if (!(await storage.exists(key)))
    await storage.put(key, pdf.data, {
      contentType: "application/pdf",
      contentLength: pdf.data.length,
    });
  const fileName = brandBookFileName({
    slug: client.slug,
    versionNumber: row.brandVersionNumber,
    number: row.number,
    final: payload.final,
  });
  await recordClientBookFile(db, {
    exportId: row.id,
    final: payload.final,
    storageKey: key,
    fileName,
    bytes: pdf.data.length,
    pages: check.data.length,
  });
  await ctx.progress(100);
  return { fileName, pages: check.data.length, dropped: built.dropped, warnings: result.warnings };
}

/** The worker spreads these into its handler map; storage and Chromium start on first use. */
export function brandBookHandlers(): JobHandlers {
  let storage: StorageDriver | undefined;
  const renderBrowser = sharedRenderBrowser();
  return {
    ...handle(brandBookRenderJob, async (payload, ctx) => {
      storage ??= createStorageFromEnv(loadEnv());
      return runBrandBookRender(
        { storage, renderBrowser: () => renderBrowser.get() },
        payload,
        ctx,
      );
    }),
  };
}
