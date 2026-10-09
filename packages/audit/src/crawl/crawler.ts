import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { guardedFetch, readTextCapped } from "@forgecy/core/net-guard";
import robotsParser from "robots-parser";
import { CrawlError, crawlError, describeFetchError, type AuditErrorCode } from "../errors";
import { sameSite, type HostCheck } from "../url";
import { AUDIT_USER_AGENT_TOKEN, type FetchedPage, type PageFetcher } from "./fetcher";

export type CrawlStepKey = "robots" | "discovery" | "screenshots" | "extraction" | "checks";

export interface CrawlProgress {
  step: CrawlStepKey;
  status: "running" | "completed" | "failed" | "skipped";
  detail?: string;
  detailRef?: MessageRef;
}

/** English detail plus its message reference, for the scan steps. */
function detailOf(key: MessageKey, values?: MessageValues) {
  return { detail: englishMessage(key, values), detailRef: messageRef(key, values) };
}

function skip(
  key: "robots" | "redirect" | "login" | "http" | "timeout" | "unreachable",
  values?: MessageValues,
) {
  const k = `audit.stored.skip.${key}` as const;
  return { reason: englishMessage(k, values), ref: messageRef(k, values) };
}

export interface SkippedPage {
  url: string;
  /** English, for logs; `ref` is what the interface shows. */
  reason: string;
  ref: MessageRef;
  code: AuditErrorCode | "LOGIN" | "HTTP";
}

export interface CrawlResult {
  robots: { found: boolean; blockedAll: boolean; aiCrawlersBlocked: string[] };
  pages: FetchedPage[];
  skipped: SkippedPage[];
  /** Set when the crawl stopped early (timeout or cancellation); pages read so far are kept. */
  stoppedEarly?: "timeout" | "cancelled";
}

export interface CrawlOptions {
  rootUrl: string;
  maxPages: number;
  /** Competitor mode: home, services and contacts only. */
  focus?: "site" | "competitor";
  fetcher: PageFetcher;
  hostCheck: HostCheck;
  userAgent: string;
  pageTimeoutMs: number;
  totalTimeoutMs: number;
  fetchImpl?: typeof fetch;
  onProgress?: (p: CrawlProgress) => Promise<void> | void;
  onPage?: (page: FetchedPage, index: number) => Promise<void> | void;
  isCancelled?: () => Promise<boolean>;
  now?: () => number;
}

const SKIP_EXT =
  /\.(pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|mov|avi|ico|xml|json|css|js)$/i;
// Path stems in Italian and English: client websites are mostly Italian.
const PRIORITY: Array<[RegExp, number]> = [
  [/(contatt|contact|dove-siamo|where)/i, 9],
  [/(serviz|service|soluzion|solution|cosa-facciamo|what-we-do)/i, 8],
  [/(chi-siamo|about|azienda|company|storia|team)/i, 7],
  [/(prodott|product|shop|catalog|negozio|offert)/i, 6],
  [/(prezz|pricing|tariff|listino)/i, 5],
  [/(portfolio|lavori|work|progett|case|clienti|clients)/i, 4],
  [/(blog|news|notizie|articol)/i, 2],
];
const COMPETITOR_PRIORITY = /(serviz|service|soluzion|solution|contatt|contact|prodott|product)/i;
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|accedi|account|wp-admin|my-account)(\/|$)/i;

/** Canonical form for de-duplication: no hash, no query, no trailing slash. */
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

function score(url: string, focus: "site" | "competitor"): number {
  const path = new URL(url).pathname;
  if (focus === "competitor") return COMPETITOR_PRIORITY.test(path) ? 10 : 0;
  for (const [re, s] of PRIORITY) if (re.test(path)) return s;
  // Shallow pages first.
  return Math.max(0, 3 - path.split("/").filter(Boolean).length);
}

/**
 * Pick the pages to read after the home: menu links first, then the in-page links,
 * then the sitemap, ranked by how much they tell about the brand.
 */
export function pickPages(input: {
  home: string;
  navLinks: string[];
  links: string[];
  sitemapUrls: string[];
  maxPages: number;
  focus: "site" | "competitor";
}): string[] {
  const seen = new Set<string>([canonicalUrl(input.home)]);
  const candidates: Array<{ url: string; rank: number }> = [];
  const add = (list: string[], bonus: number) => {
    for (const raw of list) {
      let url: string;
      try {
        url = canonicalUrl(raw);
      } catch {
        continue;
      }
      if (seen.has(url) || !sameSite(url, input.home)) continue;
      if (SKIP_EXT.test(new URL(url).pathname) || LOGIN_PATH.test(new URL(url).pathname)) continue;
      seen.add(url);
      candidates.push({ url, rank: score(url, input.focus) * 10 + bonus });
    }
  };
  add(input.navLinks, 5);
  add(input.links, 2);
  add(input.sitemapUrls, 0);
  const picked = candidates
    .sort((a, b) => b.rank - a.rank)
    .filter((c) => input.focus === "site" || c.rank >= 10 * 10)
    .map((c) => c.url);
  return [input.home, ...picked].slice(0, input.maxPages);
}

const MAX_ROBOTS_SITEMAP_BYTES = 500_000;
/** Root, landed site and two more (www/apex, http/https variants). */
const MAX_ROBOTS_ORIGINS = 4;

/**
 * robots.txt / sitemap fetch: every redirect hop goes through the host check, the body is
 * read up to a byte cap. Null for anything that goes wrong (blocked hop, loop, network).
 */
async function fetchText(
  url: string,
  options: Pick<CrawlOptions, "userAgent" | "fetchImpl" | "hostCheck">,
): Promise<{ status: number; text: string } | null> {
  try {
    const { res } = await guardedFetch(url, {
      hostCheck: options.hostCheck,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      headers: { "user-agent": options.userAgent },
      timeoutMs: 10_000,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { status: res.status, text: "" };
    }
    return { status: res.status, text: await readTextCapped(res, MAX_ROBOTS_SITEMAP_BYTES) };
  } catch {
    return null;
  }
}

/** User agents of the AI answer engines' crawlers, checked against robots.txt. */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
] as const;

/** URLs listed in sitemap.xml (one level of sitemap index followed). */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) =>
    m[1]!.replace(/&amp;/g, "&"),
  );
  return /<sitemapindex/i.test(xml) ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

/**
 * Read a site within the audit limits: robots.txt is always respected, pages behind
 * a login are skipped with the reason, every page has its own timeout and the whole
 * crawl has a deadline. Pages already read are kept when it stops early.
 */
export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + options.totalTimeoutMs;
  const focus = options.focus ?? "site";
  const progress = async (p: CrawlProgress) => options.onProgress?.(p);
  const root = new URL(options.rootUrl);
  const home = canonicalUrl(root.toString());

  if (!(await options.hostCheck(home))) {
    throw crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.hostLocal", {
      host: root.hostname,
    });
  }

  // 1. robots.txt
  await progress({ step: "robots", status: "running" });
  // robots-parser answers only for its own origin (undefined for any other), so every
  // origin read gets its own robots.txt, fetched once through the guarded path.
  const readRobots = async (origin: string) => {
    const url = `${origin}/robots.txt`;
    const res = await fetchText(url, options);
    const found = res !== null && res.status === 200;
    return { found, parser: robotsParser(url, found ? res!.text : "") };
  };
  // At most MAX_ROBOTS_ORIGINS robots.txt per crawl: a URL on a further origin is not read.
  const robotsByOrigin = new Map<string, ReturnType<typeof readRobots>>();
  const robotsOf = (origin: string) => {
    if (!robotsByOrigin.has(origin)) {
      if (robotsByOrigin.size >= MAX_ROBOTS_ORIGINS) return null;
      robotsByOrigin.set(origin, readRobots(origin));
    }
    return robotsByOrigin.get(origin)!;
  };
  const isAllowed = async (url: string) => {
    const robotsTxt = robotsOf(new URL(url).origin);
    return (
      robotsTxt !== null &&
      (await robotsTxt).parser.isAllowed(url, AUDIT_USER_AGENT_TOKEN) !== false
    );
  };
  const { found: robotsFound, parser: robots } = (await robotsOf(root.origin))!;
  const blockedAll = !(await isAllowed(home));
  const aiCrawlersBlocked = AI_CRAWLERS.filter((bot) => robots.isAllowed(home, bot) === false);
  await progress({
    step: "robots",
    status: "completed",
    ...detailOf(robotsFound ? "audit.scan.robotsFound" : "audit.scan.robotsMissing"),
  });
  if (blockedAll) {
    throw crawlError("AUD-ROBOTS-BLOCKED", "audit.stored.crawl.robotsBlocked");
  }

  // 2. Home + discovery
  await progress({ step: "discovery", status: "running" });
  const pages: FetchedPage[] = [];
  const skipped: SkippedPage[] = [];
  const fetchOpts = { timeoutMs: options.pageTimeoutMs, screenshots: true };
  let homePage: FetchedPage;
  try {
    homePage = await options.fetcher.fetchPage(home, fetchOpts);
  } catch (err) {
    await progress({ step: "discovery", status: "failed" });
    if (err instanceof CrawlError) throw err;
    throw crawlError("SOURCE-UNAVAILABLE", "audit.stored.crawl.unreachable", {
      host: root.hostname,
      detail: describeFetchError(err),
    });
  }
  // A redirect to another site is followed only if where it landed passes the host check
  // too (the browser fetcher already discards inward hops; this holds for any fetcher).
  if (!(await options.hostCheck(homePage.finalUrl))) {
    await progress({ step: "discovery", status: "failed" });
    throw crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.addressLocal", {
      url: homePage.finalUrl,
    });
  }
  if (homePage.status >= 400 || homePage.status === 0) {
    await progress({ step: "discovery", status: "failed" });
    throw crawlError("SOURCE-UNAVAILABLE", "audit.stored.crawl.httpError", {
      host: root.hostname,
      status: homePage.status,
    });
  }
  // The site is where the home page landed (oldbrand.it may 301 to newbrand.com).
  const site = canonicalUrl(homePage.finalUrl);
  const siteOrigin = new URL(site).origin;
  if (!(await isAllowed(site))) {
    await progress({ step: "discovery", status: "failed" });
    throw crawlError("AUD-ROBOTS-BLOCKED", "audit.stored.crawl.robotsBlocked");
  }
  // The second origin of the map, so robotsOf never returns null here.
  const siteRobots = (await robotsOf(siteOrigin))!.parser;
  const sitemapUrls: string[] = [];
  const listed = [...new Set([...siteRobots.getSitemaps(), ...robots.getSitemaps()])].filter((sm) =>
    sameSite(sm, site),
  );
  const sitemapCandidates = listed.length
    ? listed.slice(0, 2)
    : [...new Set([`${siteOrigin}/sitemap.xml`, `${root.origin}/sitemap.xml`])];
  for (const sm of sitemapCandidates) {
    if (!sameSite(sm, site)) continue;
    const res = await fetchText(sm, options);
    if (!res || res.status !== 200) continue;
    const parsed = parseSitemap(res.text);
    sitemapUrls.push(...parsed.urls.slice(0, 200));
    for (const child of parsed.sitemaps.slice(0, 2)) {
      if (!sameSite(child, site)) continue;
      const c = await fetchText(child, options);
      if (c?.status === 200) sitemapUrls.push(...parseSitemap(c.text).urls.slice(0, 200));
    }
    if (sitemapUrls.length) break;
  }
  const targets = pickPages({
    home: site,
    navLinks: homePage.navLinks,
    links: homePage.links,
    sitemapUrls,
    maxPages: options.maxPages,
    focus,
  });
  await progress({
    step: "discovery",
    status: "completed",
    ...detailOf("audit.scan.discovery", { count: targets.length, max: options.maxPages }),
  });

  // 3. Pages
  await progress({ step: "screenshots", status: "running" });
  await progress({ step: "extraction", status: "running" });
  pages.push(homePage);
  await options.onPage?.(homePage, 0);
  let stoppedEarly: CrawlResult["stoppedEarly"];
  for (const url of targets.slice(1)) {
    if (now() > deadline) {
      stoppedEarly = "timeout";
      break;
    }
    if (await options.isCancelled?.()) {
      stoppedEarly = "cancelled";
      break;
    }
    // Fail closed: a URL off the site has no robots.txt of ours to answer for it.
    if (!sameSite(url, site)) {
      skipped.push({ url, ...skip("redirect"), code: "HTTP" });
      continue;
    }
    if (!(await isAllowed(url))) {
      skipped.push({ url, ...skip("robots"), code: "AUD-ROBOTS-BLOCKED" });
      continue;
    }
    try {
      const page = await options.fetcher.fetchPage(url, {
        ...fetchOpts,
        timeoutMs: Math.min(options.pageTimeoutMs, Math.max(1000, deadline - now())),
      });
      if (!(await options.hostCheck(page.finalUrl))) {
        skipped.push({ url, ...skip("unreachable"), code: "AUD-HOST-BLOCKED" });
      } else if (!sameSite(page.finalUrl, site)) {
        skipped.push({ url, ...skip("redirect"), code: "HTTP" });
      } else if (!(await isAllowed(page.finalUrl))) {
        // A redirect into a disallowed path: the request happened, the page is not kept.
        skipped.push({ url, ...skip("robots"), code: "AUD-ROBOTS-BLOCKED" });
      } else if (page.requiresLogin || LOGIN_PATH.test(new URL(page.finalUrl).pathname)) {
        skipped.push({ url, ...skip("login"), code: "LOGIN" });
      } else if (page.status >= 400) {
        skipped.push({ url, ...skip("http", { status: page.status }), code: "HTTP" });
      } else {
        pages.push(page);
        await options.onPage?.(page, pages.length - 1);
      }
    } catch (err) {
      const code = err instanceof CrawlError ? err.code : "SOURCE-UNAVAILABLE";
      skipped.push({
        url,
        ...skip(code === "AUD-CRAWL-TIMEOUT" ? "timeout" : "unreachable"),
        code,
      });
    }
    await progress({
      step: "screenshots",
      status: "running",
      ...detailOf("audit.scan.progress", { read: pages.length, total: targets.length }),
    });
  }
  const shots = pages.filter((p) => p.screenshotDesktop).length;
  await progress({
    step: "screenshots",
    status: options.fetcher.mode === "browser" ? "completed" : "skipped",
    ...(options.fetcher.mode === "browser"
      ? detailOf("audit.scan.screenshots", { pages: pages.length, shots: shots * 2 })
      : detailOf("audit.scan.noChromium")),
  });
  await progress({
    step: "extraction",
    status: "completed",
    ...detailOf("audit.scan.extraction", { count: pages.length }),
  });
  return {
    robots: { found: robotsFound, blockedAll, aiCrawlersBlocked },
    pages,
    skipped,
    stoppedEarly,
  };
}
