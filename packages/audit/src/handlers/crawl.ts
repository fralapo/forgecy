import { AUDIT_LIMITS } from "@forgecy/core";
import {
  and,
  auditChannelStates,
  auditCompetitors,
  audits,
  auditSources,
  eq,
  inArray,
  ne,
  siteScans,
  type ScanStep,
} from "@forgecy/db";
import { contentKey, sha256 } from "@forgecy/files";
import { englishMessage, messageRef } from "@forgecy/i18n";
import { UnrecoverableError, type JobContext } from "@forgecy/jobs";
import { crawlSite, type CrawlProgress, type CrawlResult } from "../crawl/crawler";
import { aggregateExtraction, technicalChecks } from "../crawl/extract";
import { createHtmlFetcher, type FetchedPage, type PageFetcher } from "../crawl/fetcher";
import { auditErrorCode, CrawlError } from "../errors";
import {
  auditAnalyzeSiteJob,
  auditCompareCompetitorsJob,
  auditProposeCompetitorsJob,
} from "../jobs";
import { aiAllowed, enqueueAuditJob, hasActiveJob, loadAudit } from "../service/common";
import type { AuditHandlerDeps } from "./context";

type ScanRow = typeof siteScans.$inferSelect;
type StepUpdate = {
  step: ScanStep["key"];
  status: ScanStep["status"];
  detail?: string;
  detailRef?: ScanStep["detailRef"];
};

async function openFetcher(deps: AuditHandlerDeps, ctx: JobContext): Promise<PageFetcher> {
  try {
    return await deps.createFetcher();
  } catch (err) {
    if (err instanceof CrawlError && err.code === "AUD-BROWSER-UNAVAILABLE") {
      ctx.logger.warn({ jobId: ctx.jobId, err: err.message }, "chromium unavailable, html only");
      return createHtmlFetcher({ userAgent: deps.userAgent, hostCheck: deps.hostCheck });
    }
    throw err;
  }
}

async function storeShot(
  deps: AuditHandlerDeps,
  clientId: string,
  bytes: Uint8Array | undefined,
): Promise<string | null> {
  if (!bytes?.byteLength) return null;
  const key = contentKey({ clientId, scope: "audit/pages", sha256: sha256(bytes), ext: "jpg" });
  await deps.storage.put(key, bytes, { contentType: "image/jpeg" });
  return key;
}

/**
 * audit.crawl: read a site (prospect: up to 10 pages; competitor: 3) and store pages,
 * screenshots, extracted elements and technical checks. A failed reading never
 * stops the audit: the scan records its error code and the next steps go on.
 */
export async function runCrawl(
  deps: AuditHandlerDeps,
  payload: { scanId: string },
  ctx: JobContext,
) {
  const { db } = deps;
  const scan = await db.query.siteScans.findFirst({ where: eq(siteScans.id, payload.scanId) });
  if (!scan?.auditId) throw new UnrecoverableError("Scan not found");
  if (scan.jobId && scan.jobId !== ctx.jobId) return { skipped: "another job owns this scan" };
  const { audit } = await loadAudit(db, scan.auditId);
  if (audit.status === "archived") return { skipped: "audit archived" };

  // A retry starts clean: pages from an interrupted attempt are dropped.
  await db.delete(auditSources).where(eq(auditSources.scanId, scan.id));
  let steps: ScanStep[] = scan.steps.map((s) => ({ key: s.key, status: "pending" }));
  const setStep = async (p: CrawlProgress | StepUpdate) => {
    const at = new Date().toISOString();
    steps = steps.map((s) =>
      s.key === p.step
        ? {
            ...s,
            status: p.status,
            ...(p.detail ? { detail: p.detail } : {}),
            ...(p.detailRef ? { detailRef: p.detailRef } : {}),
            ...(p.status === "running" && !s.startedAt ? { startedAt: at } : {}),
            ...(p.status !== "running" ? { endedAt: at } : {}),
          }
        : s,
    );
    await db.update(siteScans).set({ steps }).where(eq(siteScans.id, scan.id));
    await ctx.heartbeat();
  };
  await db
    .update(siteScans)
    .set({
      status: "collecting",
      startedAt: new Date(),
      jobId: ctx.jobId,
      error: null,
      errorCode: null,
      steps,
    })
    .where(eq(siteScans.id, scan.id));

  const fetcher = await openFetcher(deps, ctx);
  let result: CrawlResult;
  let pagesStored = 0;
  try {
    result = await crawlSite({
      rootUrl: scan.rootUrl,
      maxPages: scan.maxPages,
      focus: scan.competitorId ? "competitor" : "site",
      fetcher,
      hostCheck: deps.hostCheck,
      userAgent: deps.userAgent,
      pageTimeoutMs: deps.pageTimeoutMs ?? AUDIT_LIMITS.pageTimeoutMs,
      totalTimeoutMs: deps.crawlTimeoutMs ?? AUDIT_LIMITS.crawlTimeoutMs,
      onProgress: setStep,
      isCancelled: () => ctx.isCancelled(),
      onPage: async (page: FetchedPage) => {
        const [desktop, mobile] = await Promise.all([
          storeShot(deps, scan.clientId, page.screenshotDesktop),
          storeShot(deps, scan.clientId, page.screenshotMobile),
        ]);
        await db.insert(auditSources).values({
          auditId: audit.id,
          scanId: scan.id,
          competitorId: scan.competitorId,
          channel: "website",
          kind: "page",
          method: "public_page",
          providedBy: "crawl",
          status: "collected",
          url: page.finalUrl,
          title: page.title.slice(0, 300) || null,
          storageKey: desktop,
          storageKeyMobile: mobile,
          mime: desktop ? "image/jpeg" : null,
          data: page.data,
          createdBy: scan.createdBy,
        });
        pagesStored++;
        await ctx.progress(10 + (80 * pagesStored) / scan.maxPages);
      },
    });
  } catch (err) {
    const known = auditErrorCode(err);
    const code = known ?? "SOURCE-UNAVAILABLE";
    // Unknown errors (file system, driver) carry paths and internals: log them, show a plain message.
    if (!known) ctx.logger.error({ jobId: ctx.jobId, err }, "site scan failed");
    const message = known
      ? err instanceof Error
        ? err.message
        : String(err)
      : "Internal error while reading the website. The details are in the worker logs.";
    steps = steps.map((s) =>
      s.status === "pending" || s.status === "running" ? { ...s, status: "skipped" } : s,
    );
    await db
      .update(siteScans)
      .set({ status: "failed", errorCode: code, error: message, finishedAt: new Date(), steps })
      .where(eq(siteScans.id, scan.id));
    await afterScan(deps, { ...scan, status: "failed", error: message }, 0);
    return { status: "failed", code };
  } finally {
    await fetcher.close().catch(() => undefined);
  }

  for (const s of result.skipped) {
    await db.insert(auditSources).values({
      auditId: audit.id,
      scanId: scan.id,
      competitorId: scan.competitorId,
      channel: "website",
      kind: "page",
      method: "public_page",
      providedBy: "crawl",
      status: "skipped",
      url: s.url,
      skipReason: s.reason,
      createdBy: scan.createdBy,
    });
  }
  await setStep({ step: "checks", status: "running" });
  const checks = technicalChecks(result.pages);
  const extracted = { ...aggregateExtraction(result.pages), checks };
  await setStep({
    step: "checks",
    status: "completed",
    detail: englishMessage("audit.scan.checks", {
      failed: checks.filter((c) => !c.ok).length,
      total: checks.length,
    }),
    detailRef: messageRef("audit.scan.checks", {
      failed: checks.filter((c) => !c.ok).length,
      total: checks.length,
    }),
  });
  const status =
    result.pages.length === 0
      ? "failed"
      : result.stoppedEarly || result.skipped.length
        ? "partial"
        : "collected";
  const stopped =
    result.stoppedEarly === "timeout"
      ? "Time limit reached: pages already read were kept"
      : result.stoppedEarly === "cancelled"
        ? "Scan stopped: pages already read were kept"
        : null;
  await db
    .update(siteScans)
    .set({
      status,
      robots: result.robots,
      extracted,
      ...(result.stoppedEarly === "timeout" ? { errorCode: "AUD-CRAWL-TIMEOUT" } : {}),
      error: stopped,
      finishedAt: new Date(),
    })
    .where(eq(siteScans.id, scan.id));
  await afterScan(deps, { ...scan, status }, result.pages.length);
  await ctx.progress(100);
  return { status, pages: result.pages.length, skipped: result.skipped.length };
}

/** Next steps once a reading ends (also after a failure). */
async function afterScan(deps: AuditHandlerDeps, scan: ScanRow, pages: number) {
  const { db } = deps;
  const { audit, client } = await loadAudit(db, scan.auditId!);
  if (audit.status === "archived" || audit.status === "delivered") return;
  const ai = aiAllowed(client.aiPolicy);
  const by = scan.createdBy;

  if (!scan.competitorId) {
    await db
      .update(auditChannelStates)
      .set({
        status: scan.status === "failed" ? "failed" : "collected",
        unavailableReason: scan.status === "failed" ? (scan.error ?? "Website not readable") : null,
      })
      .where(
        and(eq(auditChannelStates.auditId, audit.id), eq(auditChannelStates.channel, "website")),
      );
    if (audit.status === "collecting")
      await db
        .update(audits)
        .set({ status: "awaiting_competitors" })
        .where(eq(audits.id, audit.id));
    const analysis: ScanStep =
      ai && pages
        ? {
            key: "analysis",
            status: "pending",
            detail: englishMessage("audit.scan.analysisPending"),
            detailRef: messageRef("audit.scan.analysisPending"),
          }
        : {
            key: "analysis",
            status: "skipped",
            detail: englishMessage(ai ? "audit.scan.analysisNoPages" : "audit.scan.analysisNoAi"),
            detailRef: messageRef(ai ? "audit.scan.analysisNoPages" : "audit.scan.analysisNoAi"),
          };
    const fresh = await db.query.siteScans.findFirst({ where: eq(siteScans.id, scan.id) });
    await db
      .update(siteScans)
      .set({ steps: (fresh?.steps ?? []).map((s) => (s.key === "analysis" ? analysis : s)) })
      .where(eq(siteScans.id, scan.id));
    if (!ai) return;
    if (pages)
      await enqueueAuditJob(deps, {
        def: auditAnalyzeSiteJob,
        payload: { auditId: audit.id, scanId: scan.id },
        audit,
        createdBy: by,
      });
    const [existing] = await db
      .select({ id: auditCompetitors.id })
      .from(auditCompetitors)
      .where(eq(auditCompetitors.auditId, audit.id))
      .limit(1);
    if (
      !existing &&
      !audit.competitorsConfirmedAt &&
      !(await hasActiveJob(db, audit.id, auditProposeCompetitorsJob.kind))
    )
      await enqueueAuditJob(deps, {
        def: auditProposeCompetitorsJob,
        payload: { auditId: audit.id },
        audit,
        createdBy: by,
      });
    return;
  }

  await db
    .update(auditCompetitors)
    .set({
      sourceStatus:
        scan.status === "failed" ? "failed" : scan.status === "partial" ? "partial" : "collected",
      sourceError: scan.status === "failed" ? (scan.error ?? "Website not readable") : null,
    })
    .where(eq(auditCompetitors.id, scan.competitorId));
  const open = await db
    .select({ id: auditCompetitors.id })
    .from(auditCompetitors)
    .where(
      and(
        eq(auditCompetitors.auditId, audit.id),
        ne(auditCompetitors.status, "removed"),
        inArray(auditCompetitors.sourceStatus, ["pending", "collecting"]),
      ),
    );
  if (open.length) return;
  const read = await db
    .select({ id: auditCompetitors.id })
    .from(auditCompetitors)
    .where(
      and(
        eq(auditCompetitors.auditId, audit.id),
        eq(auditCompetitors.status, "confirmed"),
        inArray(auditCompetitors.sourceStatus, ["collected", "partial"]),
      ),
    );
  if (ai && read.length && !(await hasActiveJob(db, audit.id, auditCompareCompetitorsJob.kind)))
    await enqueueAuditJob(deps, {
      def: auditCompareCompetitorsJob,
      payload: { auditId: audit.id },
      audit,
      createdBy: by,
    });
  else if (audit.status === "analyzing")
    await db.update(audits).set({ status: "in_review" }).where(eq(audits.id, audit.id));
}
