import { AUDIT_LIMITS, type MessageRef } from "@forgecy/core";
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
import { stored } from "../stored";
import { createPinnedFetch } from "../url";
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

async function openFetcher(
  deps: AuditHandlerDeps,
  ctx: JobContext,
  rootUrl: string,
): Promise<PageFetcher> {
  try {
    return await deps.createFetcher(rootUrl);
  } catch (err) {
    if (err instanceof CrawlError && err.code === "AUD-BROWSER-UNAVAILABLE") {
      ctx.logger.warn({ jobId: ctx.jobId, err: err.message }, "chromium unavailable, html only");
      return createHtmlFetcher({
        userAgent: deps.userAgent,
        hostCheck: deps.hostCheck,
        allowPrivate: deps.allowPrivate,
      });
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

  const fetcher = await openFetcher(deps, ctx, scan.rootUrl);
  let result: CrawlResult;
  let pagesStored = 0;
  try {
    result = await crawlSite({
      rootUrl: scan.rootUrl,
      maxPages: scan.maxPages,
      focus: scan.competitorId ? "competitor" : "site",
      fetcher,
      hostCheck: deps.hostCheck,
      fetchImpl: createPinnedFetch({ allowPrivate: deps.allowPrivate }),
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
    const internal = stored("audit.stored.crawl.internal");
    const message = known ? (err instanceof Error ? err.message : String(err)) : internal.text;
    // A crawl error carries its translation; a raw driver message has none.
    const errorRef = known ? (err instanceof CrawlError ? (err.ref ?? null) : null) : internal.ref;
    steps = steps.map((s) =>
      s.status === "pending" || s.status === "running" ? { ...s, status: "skipped" } : s,
    );
    await db
      .update(siteScans)
      .set({
        status: "failed",
        errorCode: code,
        error: message,
        errorRef,
        finishedAt: new Date(),
        steps,
      })
      .where(eq(siteScans.id, scan.id));
    await afterScan(deps, { ...scan, status: "failed", error: message, errorRef }, 0);
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
      skipRef: s.ref,
      createdBy: scan.createdBy,
    });
  }
  await setStep({ step: "checks", status: "running" });
  const checks = technicalChecks(result.pages, result.robots);
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
      ? stored("audit.stored.crawl.timeLimit")
      : result.stoppedEarly === "cancelled"
        ? stored("audit.stored.crawl.stopped")
        : null;
  await db
    .update(siteScans)
    .set({
      status,
      robots: result.robots,
      extracted,
      ...(result.stoppedEarly === "timeout" ? { errorCode: "AUD-CRAWL-TIMEOUT" } : {}),
      error: stopped?.text ?? null,
      errorRef: stopped?.ref ?? null,
      finishedAt: new Date(),
    })
    .where(eq(siteScans.id, scan.id));
  await afterScan(deps, { ...scan, status }, result.pages.length);
  await ctx.progress(100);
  return { status, pages: result.pages.length, skipped: result.skipped.length };
}

/** Why a website could not be read, as `{ [text]: English, [ref]: reference }`. */
function scanFailure<T extends string, R extends string>(
  scan: Pick<ScanRow, "error" | "errorRef">,
  text: T,
  ref: R,
) {
  const fallback = stored("audit.stored.unavailable.websiteUnreadable");
  return {
    [text]: scan.error ?? fallback.text,
    [ref]: scan.error ? (scan.errorRef ?? null) : fallback.ref,
  } as Record<T, string> & Record<R, MessageRef | null>;
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
        ...(scan.status === "failed"
          ? scanFailure(scan, "unavailableReason", "unavailableRef")
          : { unavailableReason: null, unavailableRef: null }),
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
      ...(scan.status === "failed"
        ? scanFailure(scan, "sourceError", "sourceErrorRef")
        : { sourceError: null, sourceErrorRef: null }),
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
