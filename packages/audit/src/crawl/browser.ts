/// <reference lib="dom" />
// The functions passed to page.evaluate run in the browser: they need DOM types in any consumer.
import { existsSync } from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { CrawlError, crawlError } from "../errors";
import { resolvePinnedAddress, type HostCheck } from "../url";
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
  const explicit = env.FORGECY_CHROMIUM_PATH;
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

/** Playwright fetcher: desktop and mobile screenshots plus computed colors and fonts. */
export async function createBrowserFetcher(options: {
  userAgent: string;
  hostCheck: HostCheck;
  /** The crawl's starting URL: its host's DNS is pinned for this browser instance,
   * closing the rebinding window between crawlSite's own check and Chromium's real
   * connection. Omit, or allowPrivate, to launch without pinning (same as before). */
  rootUrl?: string;
  allowPrivate?: boolean;
  executablePath?: string;
}): Promise<PageFetcher> {
  const { chromium } = await import("playwright-core");
  const resolverRules: string[] = [];
  if (options.rootUrl) {
    let host: string | undefined;
    try {
      host = new URL(options.rootUrl).hostname;
    } catch {
      // Let crawlSite's own validation reject the malformed URL.
    }
    if (host) {
      const pinned = await resolvePinnedAddress(host, { allowPrivate: options.allowPrivate });
      if (pinned) resolverRules.push(`MAP ${host} ${pinned}`);
    }
  }
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
    // Every navigation (redirects and frames included) goes through the host check.
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      if (req.resourceType() === "media") return route.abort();
      if (req.isNavigationRequest() && !(await options.hostCheck(req.url())))
        return route.abort("blockedbyclient");
      return route.continue();
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

  async function open(ctx: BrowserContext, url: string, timeoutMs: number) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(timeoutMs);
    try {
      const response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
      // Give late layout and web fonts a moment, without waiting for endless trackers.
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
      return { page, response };
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
  }

  return {
    mode: "browser",
    async fetchPage(url, { timeoutMs, screenshots }): Promise<FetchedPage> {
      const { page, response } = await open(desktop, url, timeoutMs);
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
            await m.page.close().catch(() => undefined);
          }
        }
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
