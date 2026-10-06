import robotsParser from "robots-parser";
import { CrawlError, type AuditErrorCode } from "../errors";
import { sameSite, type HostCheck } from "../url";
import { AUDIT_USER_AGENT_TOKEN, type FetchedPage, type PageFetcher } from "./fetcher";

export type CrawlStepKey = "robots" | "discovery" | "screenshots" | "extraction" | "checks";

export interface CrawlProgress {
  step: CrawlStepKey;
  status: "running" | "completed" | "failed" | "skipped";
  detail?: string;
}

export interface SkippedPage {
  url: string;
  reason: string;
  code: AuditErrorCode | "LOGIN" | "HTTP";
}

export interface CrawlResult {
  robots: { found: boolean; blockedAll: boolean };
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

async function fetchText(
  url: string,
  options: Pick<CrawlOptions, "userAgent" | "fetchImpl" | "hostCheck">,
): Promise<{ status: number; text: string } | null> {
  if (!(await options.hostCheck(url))) return null;
  try {
    const res = await (options.fetchImpl ?? fetch)(url, {
      headers: { "user-agent": options.userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const text = res.ok ? (await res.text()).slice(0, 500_000) : "";
    return { status: res.status, text };
  } catch {
    return null;
  }
}

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
    throw new CrawlError(
      "AUD-HOST-BLOCKED",
      `${root.hostname} punta alla rete locale: Forgecy non lo legge.`,
    );
  }

  // 1. robots.txt
  await progress({ step: "robots", status: "running" });
  const robotsUrl = `${root.origin}/robots.txt`;
  const robotsRes = await fetchText(robotsUrl, options);
  const robotsFound = robotsRes !== null && robotsRes.status === 200;
  const robots = robotsParser(robotsUrl, robotsFound ? robotsRes!.text : "");
  const isAllowed = (url: string) => robots.isAllowed(url, AUDIT_USER_AGENT_TOKEN) !== false;
  const blockedAll = !isAllowed(home);
  await progress({
    step: "robots",
    status: "completed",
    detail: robotsFound ? "robots.txt presente" : "robots.txt assente: lettura consentita",
  });
  if (blockedAll) {
    throw new CrawlError(
      "AUD-ROBOTS-BLOCKED",
      "robots.txt non permette di leggere il sito. Forgecy non lo aggira.",
    );
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
    throw new CrawlError(
      "SOURCE-UNAVAILABLE",
      `Non riusciamo a raggiungere ${root.hostname}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (homePage.status >= 400 || homePage.status === 0) {
    await progress({ step: "discovery", status: "failed" });
    throw new CrawlError(
      "SOURCE-UNAVAILABLE",
      `${root.hostname} risponde con errore ${homePage.status}.`,
    );
  }
  const sitemapUrls: string[] = [];
  for (const sm of robots.getSitemaps().length
    ? robots.getSitemaps().slice(0, 2)
    : [`${root.origin}/sitemap.xml`]) {
    const res = await fetchText(sm, options);
    if (!res || res.status !== 200) continue;
    const parsed = parseSitemap(res.text);
    sitemapUrls.push(...parsed.urls.slice(0, 200));
    for (const child of parsed.sitemaps.slice(0, 2)) {
      const c = await fetchText(child, options);
      if (c?.status === 200) sitemapUrls.push(...parseSitemap(c.text).urls.slice(0, 200));
    }
    if (sitemapUrls.length) break;
  }
  const targets = pickPages({
    home: canonicalUrl(homePage.finalUrl),
    navLinks: homePage.navLinks,
    links: homePage.links,
    sitemapUrls,
    maxPages: options.maxPages,
    focus,
  });
  await progress({
    step: "discovery",
    status: "completed",
    detail: `${targets.length} pagine da leggere (massimo ${options.maxPages})`,
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
    if (!isAllowed(url)) {
      skipped.push({ url, reason: "Esclusa da robots.txt", code: "AUD-ROBOTS-BLOCKED" });
      continue;
    }
    try {
      const page = await options.fetcher.fetchPage(url, {
        ...fetchOpts,
        timeoutMs: Math.min(options.pageTimeoutMs, Math.max(1000, deadline - now())),
      });
      if (!sameSite(page.finalUrl, home)) {
        skipped.push({ url, reason: "Reindirizza a un altro sito", code: "HTTP" });
      } else if (page.requiresLogin || LOGIN_PATH.test(new URL(page.finalUrl).pathname)) {
        skipped.push({ url, reason: "Richiede login", code: "LOGIN" });
      } else if (page.status >= 400) {
        skipped.push({ url, reason: `Errore ${page.status}`, code: "HTTP" });
      } else {
        pages.push(page);
        await options.onPage?.(page, pages.length - 1);
      }
    } catch (err) {
      const code = err instanceof CrawlError ? err.code : "SOURCE-UNAVAILABLE";
      skipped.push({
        url,
        reason: code === "AUD-CRAWL-TIMEOUT" ? "Timeout" : "Non raggiungibile",
        code,
      });
    }
    await progress({
      step: "screenshots",
      status: "running",
      detail: `Pagine lette ${pages.length}/${targets.length}`,
    });
  }
  const shots = pages.filter((p) => p.screenshotDesktop).length;
  await progress({
    step: "screenshots",
    status: options.fetcher.mode === "browser" ? "completed" : "skipped",
    detail:
      options.fetcher.mode === "browser"
        ? `${pages.length} pagine lette · ${shots * 2} screenshot`
        : "Chromium non disponibile: nessuno screenshot",
  });
  await progress({
    step: "extraction",
    status: "completed",
    detail: `${pages.length} pagine analizzate`,
  });
  return { robots: { found: robotsFound, blockedAll }, pages, skipped, stoppedEarly };
}
