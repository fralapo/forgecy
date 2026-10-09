/**
 * brand.crawl_website: reads the client's own site with the same crawler used for
 * Prospect audits (robots.txt respected, same domain only, a page limit), stores
 * what it finds as a `website` source, then runs the usual Brand Analyst step
 * (see import/run.ts) exactly as if those pages had been typed in by hand.
 */
import { createPinnedFetch, CrawlError, createHostCheck } from "@forgecy/audit";
import { createBrowserFetcher, resolveChromiumPath } from "@forgecy/audit/crawl/browser";
import { crawlSite } from "@forgecy/audit/crawl/crawler";
import { auditUserAgent, createHtmlFetcher, type PageFetcher } from "@forgecy/audit/crawl/fetcher";
import { AUDIT_LIMITS, loadToolEnv, type Actor, type MessageRef } from "@forgecy/core";
import { and, brandSources, eq } from "@forgecy/db";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { applyImport, autoImportStatus } from "./auto-import";
import type { ImportContext, ImportDeps, ImportResult } from "./import/run";
import { runSourceImport } from "./import/run";
import { harvestImages } from "./import/images";
import { readSocialSource, type SocialKind } from "./import/social";
import { mergeProbes } from "./probe-merge";
import { findOrCreateSocialSource, updateSourceStatus } from "./service";
import { socialProfileOf } from "./social-url";

export { mergeProbes } from "./probe-merge";

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

/** A client site rarely needs more than this to tell brand, offer, products and contacts apart. */
const MAX_PAGES = 15;
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
  let fetcher: PageFetcher | undefined;
  let visual: ReturnType<typeof mergeProbes> | undefined;
  const pageLinks: string[] = [];

  try {
    // The browser reads the real colors, fonts and logos; without Chromium (or when it cannot
    // be pinned to a public address) the markup-only fetcher reads the text and crawlSite
    // reports a blocked host properly, with no visual data.
    try {
      const executablePath = resolveChromiumPath();
      fetcher = await createBrowserFetcher({
        userAgent,
        rootUrl: source.url,
        allowPrivate,
        ...(executablePath ? { executablePath } : {}),
      });
    } catch (err) {
      if (!(
        err instanceof CrawlError &&
        (err.code === "AUD-BROWSER-UNAVAILABLE" || err.code === "AUD-HOST-BLOCKED")
      ))
        throw err;
      fetcher = createHtmlFetcher({ userAgent, hostCheck, allowPrivate });
    }
    const result = await crawlSite({
      rootUrl: source.url,
      maxPages: MAX_PAGES,
      focus: "site",
      brandProbe: true,
      screenshots: false,
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
    pageLinks.push(...result.pages.flatMap((p) => p.links));
    const probes = result.pages.flatMap((p) => (p.brand ? [p.brand] : []));
    if (probes.length) visual = mergeProbes(probes);
    await updateSourceStatus(db, source.id, {
      status: pages.length
        ? result.stoppedEarly || result.skipped.length
          ? "partial"
          : "extracted"
        : "failed",
      pages,
      visual: visual ? (visual as unknown as Record<string, unknown>) : null,
      ...detail(parts),
    });
    if (!pages.length)
      return {
        sourceId: source.id,
        pages: 0,
        candidates: 0,
        proposals: 0,
        skipped: 0,
        discarded: 0,
        ai: "skipped",
        detail: detail(parts).statusDetail,
      };
  } catch (err) {
    const ref = err instanceof CrawlError ? err.ref : undefined;
    const message = err instanceof Error ? err.message : String(err);
    await updateSourceStatus(db, source.id, {
      status: "failed",
      pages: [],
      visual: null,
      statusDetail: message.slice(0, 500),
      statusDetailRef: ref ? [ref] : null,
    });
    return {
      sourceId: source.id,
      pages: 0,
      candidates: 0,
      proposals: 0,
      skipped: 0,
      discarded: 0,
      ai: "skipped",
      detail: message,
    };
  } finally {
    await fetcher?.close().catch(() => undefined);
  }
  await ctx.progress?.(20);

  // The images and the logo go into the asset library before the import, so the logo can be proposed.
  let logo: Awaited<ReturnType<typeof harvestImages>>["logo"];
  const notes: MessageRef[] = [];
  if (visual)
    try {
      const harvest = await harvestImages(deps, {
        clientId: input.clientId,
        sourceId: source.id,
        images: visual.images,
        logos: visual.logos,
        requestedBy: ctx.requestedBy ?? null,
        allowPrivate,
      });
      logo = harvest.logo;
      if (harvest.failed)
        notes.push(msg("brand.import.status.imagesFailed", { count: harvest.failed }));
    } catch {
      // Pictures are a bonus: the text import goes on, and its status line says they failed.
      const count = Math.max(1, visual.images.length + (visual.logos.length ? 1 : 0));
      notes.push(msg("brand.import.status.imagesFailed", { count }));
    }
  await ctx.progress?.(30);

  // The pages are now on the source: the rest is identical to a typed-in text source.
  const result = await runSourceImport(deps, ctx, {
    ...input,
    ...(logo ? { logo } : {}),
    ...(notes.length ? { notes } : {}),
  });

  // The profiles the site links to come after the site itself, in the same run.
  await runSocialProfiles(deps, ctx, {
    clientId: input.clientId,
    ...(input.language ? { language: input.language } : {}),
    allowPrivate,
    profiles: collectSocialProfiles([...(visual?.organization?.sameAs ?? []), ...pageLinks]),
  });

  // Applied once for the whole run (site and profiles), so one import publishes one version.
  const auto = await applyImport(db, {
    clientId: input.clientId,
    requestedBy: ctx.requestedBy ?? null,
    runId: ctx.jobId,
  });
  const lines = autoImportStatus(auto);
  if (lines.length) {
    const [row] = await db
      .select({ refs: brandSources.statusDetailRef })
      .from(brandSources)
      .where(eq(brandSources.id, source.id));
    await updateSourceStatus(db, source.id, detail([...(row?.refs ?? []), ...lines]));
  }
  return { ...result, auto };
}

/** A site rarely lists more than a handful of real profiles; the rest is noise. */
const MAX_SOCIAL_PROFILES = 4;

/** Profile links among the given addresses, canonical, without duplicates; share and post links and people's LinkedIn pages drop out. */
export function collectSocialProfiles(urls: string[]): Array<{ kind: SocialKind; url: string }> {
  const seen = new Map<string, { kind: SocialKind; url: string }>();
  for (const raw of urls) {
    const profile = socialProfileOf(raw);
    // A person's LinkedIn page found on an arbitrary site is that person's data, not the brand's.
    if (profile?.kind === "linkedin" && new URL(profile.url).pathname.startsWith("/in/")) continue;
    if (profile && !seen.has(profile.url)) seen.set(profile.url, profile);
  }
  return [...seen.values()].slice(0, MAX_SOCIAL_PROFILES);
}

/**
 * Registers and imports each public social profile as its own source, one after the other. A
 * profile that cannot be read leaves its source `partial` with the reason; it never stops the
 * others or the site import that already ran.
 */
export async function runSocialProfiles(
  deps: ImportDeps,
  ctx: ImportContext,
  input: {
    clientId: string;
    language?: string;
    allowPrivate: boolean;
    profiles: Array<{ kind: SocialKind; url: string }>;
  },
): Promise<ImportResult[]> {
  const { db } = deps;
  const agent: Actor = { type: "agent", role: "brand_analyst", runId: ctx.jobId };
  // Progress already moved on with the site; a profile restarting at 30% would only confuse it.
  const quiet: ImportContext = { ...ctx, progress: async () => undefined };
  const results: ImportResult[] = [];
  for (const profile of input.profiles) {
    let sourceId: string | undefined;
    let pagesStored = false;
    try {
      const { source, created } = await findOrCreateSocialSource(db, agent, {
        clientId: input.clientId,
        ...profile,
      });
      sourceId = source.id;
      pagesStored = !!source.pages?.length;
      // A profile already imported keeps what it has: its proposals were made, and may have been
      // judged. One whose import did not finish (still extracting, or failed) is tried again.
      if (!created && pagesStored && ["extracted", "partial"].includes(source.status)) continue;
      await updateSourceStatus(db, source.id, {
        status: "extracting",
        ...detail([msg("brand.import.status.reading")]),
      });
      // The page of an earlier attempt is already on the source: no second request for it.
      if (!pagesStored) {
        const read = await readSocialSource(
          { db, storage: deps.storage },
          { id: source.id, url: profile.url, kind: profile.kind },
          {
            clientId: input.clientId,
            requestedBy: ctx.requestedBy ?? null,
            allowPrivate: input.allowPrivate,
            ...deps.socialNet,
          },
        );
        if (!read.pages.length) continue;
        pagesStored = true;
      }
      results.push(
        await runSourceImport(deps, quiet, {
          clientId: input.clientId,
          sourceId: source.id,
          ...(input.language ? { language: input.language } : {}),
        }),
      );
    } catch (err) {
      // Only the kind of error goes on the source (never its message, which may carry an address).
      const reason = err instanceof Error ? err.name : "Error";
      if (sourceId)
        await updateSourceStatus(db, sourceId, {
          status: pagesStored ? "failed" : "partial",
          ...detail([
            pagesStored
              ? msg("brand.import.status.socialImportFailed", { reason })
              : msg("brand.import.status.socialUnreachable"),
          ]),
        }).catch(() => undefined);
    }
  }
  return results;
}
