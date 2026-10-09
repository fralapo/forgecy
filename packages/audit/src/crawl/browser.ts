/// <reference lib="dom" />
// The functions passed to page.evaluate run in the browser: they need DOM types in any consumer.
import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page, Request } from "playwright-core";
import { CrawlError, crawlError } from "../errors";
import { loadToolEnv } from "@forgecy/core";
import { createHostCheck, resolvePublicAddress } from "@forgecy/core/net-guard";
import type { HostCheck } from "../url";
import { extractFromHtml, type FetchedPage, type PageFetcher } from "./fetcher";

const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };
/** Long pages are cut so a screenshot stays a few hundred KB. */
const MAX_SCREENSHOT_HEIGHT = 6000;

/**
 * Chromium location: FORGECY_CHROMIUM_PATH, else Playwright's own browsers
 * (PLAYWRIGHT_BROWSERS_PATH, as in the Playwright worker image).
 */
export function resolveChromiumPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = loadToolEnv(env).FORGECY_CHROMIUM_PATH;
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  const base = env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && existsSync(`${base}/chromium`)) return `${base}/chromium`;
  return undefined;
}

/** Runs in the page: computed colors and fonts weighted by visible area and text length. */
function measureStyles() {
  const toHex = (c: string): string | null => {
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) < 0.5) return null;
    return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
  };
  const colors = new Map<string, number>();
  const fonts = new Map<string, { role: "headings" | "body"; weight: number }>();
  const viewportArea = window.innerWidth * Math.max(window.innerHeight, 1);
  const elements = Array.from(document.querySelectorAll("body, body *")).slice(0, 4000);
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const bg = toHex(style.backgroundColor);
    if (bg) {
      const area = Math.min(rect.width * rect.height, viewportArea * 3);
      colors.set(bg, (colors.get(bg) ?? 0) + area);
    }
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    if (ownText.length > 0) {
      const fg = toHex(style.color);
      const weight = ownText.length * parseFloat(style.fontSize || "16");
      if (fg) colors.set(fg, (colors.get(fg) ?? 0) + weight * 20);
      const family = (style.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim();
      if (family) {
        const role = /^H[1-3]$/.test(el.tagName) ? "headings" : "body";
        const key = `${family}|${role}`;
        const prev = fonts.get(key);
        fonts.set(key, { role, weight: (prev?.weight ?? 0) + ownText.length });
      }
    }
  }
  return {
    colors: Array.from(colors, ([hex, weight]) => ({ hex, weight })),
    fonts: Array.from(fonts, ([key, v]) => ({ family: key.split("|")[0]!, ...v })),
    loadMs: Math.round(
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        ?.duration ?? 0,
    ),
  };
}

/**
 * Chromium `--host-resolver-rules` that pin the crawl's root host to the address we
 * validated, closing the rebinding window between our check and Chromium's own
 * lookup. FAILS CLOSED: if the root host is, or resolves to, a private address the
 * browser is not launched at all (it used to launch unpinned, i.e. unprotected).
 */
export async function pinRootHost(
  rootUrl: string | undefined,
  allowPrivate: boolean | undefined,
): Promise<string[]> {
  if (!rootUrl || allowPrivate) return [];
  let host: string;
  try {
    host = new URL(rootUrl).hostname;
  } catch {
    return []; // crawlSite's own validation rejects the malformed URL
  }
  const pinned = await resolvePublicAddress(host);
  if (pinned.ok) {
    const target = pinned.address.includes(":") ? `[${pinned.address}]` : pinned.address;
    return [`MAP ${host} ${target}`];
  }
  if (pinned.reason === "private")
    throw crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.hostLocal", { host });
  throw crawlError("AUD-BROWSER-UNAVAILABLE", "audit.stored.crawl.browserUnavailable", {
    detail: "host does not resolve",
  });
}

/** Every request the page makes (images, scripts, XHR, frames) must pass the host check; inline schemes cannot reach the network. */
export async function allowBrowserRequest(url: string, hostCheck: HostCheck): Promise<boolean> {
  if (/^(data|blob|about):/i.test(url)) return true;
  return hostCheck(url);
}

/** Every URL a request went through, oldest first: its redirect hops, then itself. */
export function redirectChain(request: Request): string[] {
  const urls: string[] = [];
  for (let r: Request | null = request; r; r = r.redirectedFrom()) urls.unshift(r.url());
  return urls;
}

/**
 * Playwright fetcher: desktop and mobile screenshots plus computed colors and fonts.
 * Its host check is built here and fails closed (Chromium resolves names itself, so a
 * host Node cannot resolve is refused): no caller can hand it a weaker one.
 */
export async function createBrowserFetcher(options: {
  userAgent: string;
  /** The crawl's starting URL: its host's DNS is pinned for this browser instance,
   * closing the rebinding window between crawlSite's own check and Chromium's real
   * connection. Required so a caller cannot launch unpinned by omission; the only
   * unpinned launch is an explicit allowPrivate. */
  rootUrl: string;
  allowPrivate?: boolean;
  executablePath?: string;
}): Promise<PageFetcher> {
  const { chromium } = await import("playwright-core");
  const hostCheck = createHostCheck({
    ...(options.allowPrivate ? { allowPrivate: true } : {}),
    failClosed: true,
  });
  const resolverRules = await pinRootHost(options.rootUrl, options.allowPrivate);
  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      args: [
        "--disable-dev-shm-usage",
        ...(resolverRules.length ? [`--host-resolver-rules=${resolverRules.join(",")}`] : []),
      ],
    });
  } catch (err) {
    throw crawlError("AUD-BROWSER-UNAVAILABLE", "audit.stored.crawl.browserUnavailable", {
      detail: err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err),
    });
  }

  async function newContext(mobile: boolean): Promise<BrowserContext> {
    const ctx = await browser.newContext({
      userAgent: options.userAgent,
      viewport: mobile ? MOBILE : DESKTOP,
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });
    // tsx/esbuild wrap named functions in a `__name` helper that does not exist in the
    // page: functions passed to page.evaluate would throw "__name is not defined".
    await ctx.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");
    // Every request goes through the host check, not only navigations: page scripts
    // could otherwise read the local network (fetch/XHR/img) and put it in the DOM.
    // Residual risk: hosts other than the root are looked up here and again by Chromium.
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (req.resourceType() === "media") return route.abort();
      if (!(await allowBrowserRequest(req.url(), hostCheck))) return route.abort("blockedbyclient");
      return route.continue();
    });
    // ctx.route does not see WebSockets: without this, page script could open
    // ws://127.0.0.1:... and talk to a local service. Same host check, on the http(s) twin.
    await ctx.routeWebSocket(/.*/, async (ws) => {
      if (await allowBrowserRequest(ws.url().replace(/^ws/i, "http"), hostCheck))
        ws.connectToServer();
      else await ws.close();
    });
    return ctx;
  }

  const desktop = await newContext(false);
  const mobile = await newContext(true);

  async function screenshot(page: Page): Promise<Uint8Array> {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewport = page.viewportSize() ?? DESKTOP;
    return page.screenshot({
      type: "jpeg",
      quality: 70,
      fullPage: height <= MAX_SCREENSHOT_HEIGHT,
      ...(height > MAX_SCREENSHOT_HEIGHT
        ? { clip: { x: 0, y: 0, width: viewport.width, height: MAX_SCREENSHOT_HEIGHT } }
        : {}),
      animations: "disabled",
    });
  }

  const blocked = (url: string) =>
    crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.addressLocal", { url });

  /**
   * ctx.route() is only called for the FIRST URL of a redirect chain: Chromium follows
   * the hops (navigations and subresources alike) without asking. So every hop is checked
   * after the fact, and a page that touched a disallowed host is discarded whole (no
   * text, title, links or screenshot). By then the request to that host HAS been sent:
   * this keeps its answer out of the audit, it does not stop the request.
   */
  function watchRedirectHops(page: Page): () => Promise<boolean> {
    const verdicts: Array<Promise<boolean>> = [];
    page.on("request", (req) => {
      if (req.redirectedFrom()) verdicts.push(allowBrowserRequest(req.url(), hostCheck));
    });
    return async () => (await Promise.all(verdicts)).every(Boolean);
  }

  async function open(ctx: BrowserContext, url: string, timeoutMs: number) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(timeoutMs);
    const hopsClean = watchRedirectHops(page);
    let response: Awaited<ReturnType<Page["goto"]>>;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
      // Give late layout and web fonts a moment, without waiting for endless trackers.
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    } catch (err) {
      await page.close().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      if (/blockedbyclient/i.test(message))
        throw crawlError("AUD-HOST-BLOCKED", "audit.stored.crawl.addressLocal", { url });
      if (/timeout/i.test(message))
        throw crawlError("AUD-CRAWL-TIMEOUT", "audit.stored.crawl.timeout", {
          seconds: timeoutMs / 1000,
        });
      throw new CrawlError("SOURCE-UNAVAILABLE", message.split("\n")[0] ?? message);
    }
    // The navigation's own chain, then where the page ended up (a script may have moved it).
    const landed = [...(response ? redirectChain(response.request()) : []), page.url()];
    for (const hop of landed) {
      if (!(await allowBrowserRequest(hop, hostCheck))) {
        await page.close().catch(() => undefined);
        throw blocked(hop);
      }
    }
    return { page, response, hopsClean };
  }

  return {
    mode: "browser",
    async fetchPage(url, { timeoutMs, screenshots }): Promise<FetchedPage> {
      const { page, response, hopsClean } = await open(desktop, url, timeoutMs);
      try {
        const finalUrl = page.url();
        const html = await page.content();
        const extracted = extractFromHtml(html, finalUrl);
        const styles = await page.evaluate(measureStyles);
        const desktopShot = screenshots ? await screenshot(page) : undefined;
        let mobileShot: Uint8Array | undefined;
        if (screenshots && !extracted.requiresLogin) {
          const m = await open(mobile, finalUrl, timeoutMs).catch(() => null);
          if (m) {
            mobileShot = await screenshot(m.page).catch(() => undefined);
            if (!(await m.hopsClean())) mobileShot = undefined;
            await m.page.close().catch(() => undefined);
          }
        }
        // A subresource (img, iframe, XHR) redirected inward may be in the DOM or the shot.
        if (!(await hopsClean())) throw blocked(finalUrl);
        return {
          ...extracted,
          url,
          finalUrl,
          status: response?.status() ?? 0,
          data: {
            ...extracted.data,
            httpStatus: response?.status() ?? 0,
            loadMs: styles.loadMs,
          },
          colors: styles.colors,
          fonts: styles.fonts,
          ...(desktopShot ? { screenshotDesktop: desktopShot } : {}),
          ...(mobileShot ? { screenshotMobile: mobileShot } : {}),
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    async close() {
      await browser.close().catch(() => undefined);
    },
  };
}
