/**
 * brand.crawl_website: reads the client's own site with the same crawler used for
 * Prospect audits (robots.txt respected, same domain only, a page limit), stores
 * what it finds as a `website` source, then runs the usual Brand Analyst step
 * (see import/run.ts) exactly as if those pages had been typed in by hand.
 */
import { createPinnedFetch, CrawlError, createHostCheck } from "@forgecy/audit";
import { crawlSite } from "@forgecy/audit/crawl/crawler";
import { auditUserAgent, createHtmlFetcher } from "@forgecy/audit/crawl/fetcher";
import { AUDIT_LIMITS, loadToolEnv, type MessageRef } from "@forgecy/core";
import { and, brandSources, eq } from "@forgecy/db";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { ImportContext, ImportDeps, ImportResult } from "./import/run";
import { runSourceImport } from "./import/run";
import { updateSourceStatus } from "./service";

const msg = (key: MessageKey & `brand.import.${string}`, values?: MessageValues) =>
  messageRef(key, values);

function detail(refs: MessageRef[]) {
  return {
    statusDetail: refs
      .map((r) => englishMessage(r.key as MessageKey, r.values))
      .join(" · ")
      .slice(0, 500),
    statusDetailRef: refs,
  };
}

/** A client site rarely needs more than this to tell brand, offer and contacts apart. */
const MAX_PAGES = 10;
const TOTAL_TIMEOUT_MS = 3 * 60_000;

/** Runs the website crawl for one source, then the Brand Analyst import over its pages. */
export async function runWebsiteCrawl(
  deps: ImportDeps,
  ctx: ImportContext,
  input: { clientId: string; sourceId: string; language?: string },
): Promise<ImportResult> {
  const { db } = deps;
  const [source] = await db
    .select()
    .from(brandSources)
    .where(and(eq(brandSources.id, input.sourceId), eq(brandSources.clientId, input.clientId)));
  if (!source || source.removedAt || !source.url)
    throw new Error("Website source not found, removed, or has no address");

  // Read the configuration first: a bad value must fail the job before the source is marked
  // "extracting", or the source would stay stuck in that state.
  const allowPrivate = loadToolEnv().FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS;

  await updateSourceStatus(db, source.id, {
    status: "extracting",
    ...detail([msg("brand.import.status.reading")]),
  });

  const userAgent = auditUserAgent();
  const hostCheck = createHostCheck({ allowPrivate });
  const fetcher = createHtmlFetcher({ userAgent, hostCheck, allowPrivate });

  try {
    const result = await crawlSite({
      rootUrl: source.url,
      maxPages: MAX_PAGES,
      focus: "site",
      fetcher,
      hostCheck,
      fetchImpl: createPinnedFetch({ allowPrivate }),
      userAgent,
      pageTimeoutMs: AUDIT_LIMITS.pageTimeoutMs,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    });
    const pages = result.pages
      .filter((p) => p.data.textExcerpt?.trim())
      .map((p) => {
        let locator = p.finalUrl;
        try {
          locator = new URL(p.finalUrl).pathname || "/";
        } catch {
          // Keep the full URL if it somehow doesn't parse.
        }
        return {
          locator,
          text: [p.title, p.data.metaDescription, ...(p.data.h1 ?? []), p.data.textExcerpt]
            .filter((v): v is string => !!v?.trim())
            .join("\n")
            .slice(0, 20_000),
        };
      });
    const parts = [
      msg("brand.import.status.crawlPages", { count: pages.length }),
      result.skipped.length
        ? msg("brand.import.status.crawlSkipped", { count: result.skipped.length })
        : null,
    ].filter((r): r is MessageRef => r !== null);
    await updateSourceStatus(db, source.id, {
      status: pages.length
        ? result.stoppedEarly || result.skipped.length
          ? "partial"
          : "extracted"
        : "failed",
      pages,
      ...detail(parts),
    });
    if (!pages.length)
      return {
        sourceId: source.id,
        pages: 0,
        candidates: 0,
        proposals: 0,
        skipped: 0,
        ai: "skipped",
        detail: detail(parts).statusDetail,
      };
  } catch (err) {
    const ref = err instanceof CrawlError ? err.ref : undefined;
    const message = err instanceof Error ? err.message : String(err);
    await updateSourceStatus(db, source.id, {
      status: "failed",
      pages: [],
      statusDetail: message.slice(0, 500),
      statusDetailRef: ref ? [ref] : null,
    });
    return {
      sourceId: source.id,
      pages: 0,
      candidates: 0,
      proposals: 0,
      skipped: 0,
      ai: "skipped",
      detail: message,
    };
  } finally {
    await fetcher.close().catch(() => undefined);
  }
  await ctx.progress?.(30);

  // The pages are now on the source: the rest is identical to a typed-in text source.
  return runSourceImport(deps, ctx, input);
}
