import { buildCarouselSchema, NEUTRAL_BRAND } from "@forgecy/carousel";
import { dbTemplateSource } from "@forgecy/carousel/catalog";
import { ExportCancelledError, exportCarousel } from "@forgecy/carousel/export";
import type { Actor, ReportVariant } from "@forgecy/core";
import { auditReports, eq } from "@forgecy/db";
import { contentKey, sha256 } from "@forgecy/files";
import { UnrecoverableError, type JobContext } from "@forgecy/jobs";
import type { Browser } from "playwright-core";
import { reportSlides } from "../report/slides";
import { loadAudit } from "../service/common";
import { buildReportDocument, recordReportExport, reportFileName } from "../service/reports";
import { needsAttention, unrecoverable, type AuditHandlerDeps } from "./context";

/** Key of the agency template in the catalog (templates/reports/report-audit-a4). */
export const REPORT_TEMPLATE_KEY = "report-audit-a4";

/**
 * “audit.report_export”: the report document becomes the pages of the published
 * “Audit report” template, rendered by the carousel renderer (PDF only). A draft
 * PDF carries the “Draft” watermark; the final one moves the audit to delivered.
 */
export async function runReportExport(
  deps: Pick<AuditHandlerDeps, "db" | "storage"> & { renderBrowser: () => Promise<Browser> },
  payload: { reportId: string; variant: ReportVariant; final: boolean },
  ctx: JobContext,
) {
  const { db, storage } = deps;
  const report = await db.query.auditReports.findFirst({
    where: eq(auditReports.id, payload.reportId),
  });
  if (!report) throw new UnrecoverableError("Report not found");
  if (payload.final && report.status !== "approved" && report.status !== "exported")
    throw unrecoverable("audit.jobErrors.noLongerApproved");
  if (!ctx.row.createdBy) throw new UnrecoverableError("Export without a person who requested it");
  const { audit, client } = await loadAudit(db, report.auditId);

  const pkg = await dbTemplateSource({ db, storage }).get(REPORT_TEMPLATE_KEY);
  if (!pkg) throw needsAttention("audit.jobErrors.templateMissing");
  await ctx.progress(5);

  const doc = await buildReportDocument(db, report.id, payload.variant);
  let built;
  try {
    built = reportSlides(doc, pkg.manifest);
  } catch (err) {
    throw needsAttention("audit.jobErrors.templateUnfit", { detail: (err as Error).message });
  }
  const check = buildCarouselSchema(pkg.manifest).safeParse(built.slides);
  if (!check.success)
    throw needsAttention(
      "audit.jobErrors.reportUnfit",
      { detail: check.error.issues[0]?.message ?? "error" },
      { issues: check.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    );

  let result;
  try {
    result = await exportCarousel(await deps.renderBrowser(), {
      pkg,
      slides: check.data,
      brand: { ...NEUTRAL_BRAND, name: doc.agency.name ?? "" },
      outputs: ["pdf"],
      draft: !payload.final,
      language: doc.language,
      meta: {
        client: client.name,
        content: `Audit ${doc.date}`,
        version: report.version,
        ...(report.approvedAt ? { approvedAt: report.approvedAt.toISOString() } : {}),
      },
      onProgress: (percent) => ctx.progress(Math.max(5, Math.min(95, percent))),
      isCancelled: () => ctx.isCancelled(),
    });
  } catch (err) {
    if (err instanceof ExportCancelledError) throw new UnrecoverableError(err.message);
    throw err;
  }
  const pdf = result.files.find((f) => f.kind === "pdf");
  if (!pdf) throw unrecoverable("audit.jobErrors.noPdf");

  const hash = sha256(pdf.data);
  const key = contentKey({ clientId: client.id, scope: "exports", sha256: hash, ext: "pdf" });
  // Content-addressed: exporting the same version twice writes nothing new.
  if (!(await storage.exists(key)))
    await storage.put(key, pdf.data, {
      contentType: "application/pdf",
      contentLength: pdf.data.length,
    });
  const fileName = reportFileName({
    slug: client.slug,
    auditDate: audit.startedAt ?? audit.createdAt,
    version: report.version,
    variant: payload.variant,
    final: payload.final,
  });
  // The person who asked for the export; permissions were checked when it was queued.
  const actor: Actor = { type: "user", id: ctx.row.createdBy, isAdmin: false, active: true };
  const row = await recordReportExport(db, actor, {
    reportId: report.id,
    variant: payload.variant,
    final: payload.final,
    storageKey: key,
    fileName,
    bytes: pdf.data.length,
    pages: check.data.length,
    jobId: ctx.jobId,
  });
  await ctx.progress(100);
  return {
    exportId: row.id,
    fileName,
    pages: check.data.length,
    droppedFindings: built.dropped,
    issues: result.issues.length,
    warnings: result.warnings,
  };
}
