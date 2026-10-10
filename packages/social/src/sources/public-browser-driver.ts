/// <reference lib="dom" />
// The functions passed to page.evaluate run in the browser: they need DOM types in any consumer.
// Worker only: this file is never exported from the package entry, so the web bundle never loads Playwright.
import type { Browser, Page } from "playwright-core";
import type { BrowserLauncher, PageDriver, RawPostDom, RawProfileDom } from "./public-browser";

const NAVIGATION_TIMEOUT_MS = 20_000;
const COOKIE_WAIT_MS = 3_000;
const RENDER_WAIT_MS = 10_000;
const DECLINE_COOKIES =
  /decline optional cookies|rifiuta cookie facoltativi|rechazar cookies opcionales|refuser les cookies facultatifs/i;
const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);

/**
 * Scripts that run in the page. They are strings on purpose: a function passed to page.evaluate
 * is serialised with toString(), and transpilers (tsx runs the worker) wrap nested functions in
 * helpers that do not exist in the page. They read only: `og:*` and `description` meta tags, the
 * header text, grid anchors and the FIRST time element (later ones belong to comments).
 */
const READ_METAS = `
  var metas = {};
  var all = document.querySelectorAll("meta");
  for (var i = 0; i < all.length; i++) {
    var key = all[i].getAttribute("property") || all[i].getAttribute("name");
    var content = all[i].getAttribute("content");
    if (key && content !== null && (key.indexOf("og:") === 0 || key === "description")) metas[key] = content;
  }
`;
const PROFILE_SCRIPT = `(function () {${READ_METAS}
  var header = document.querySelector("header");
  var anchors = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
  var links = [];
  for (var j = 0; j < anchors.length; j++) {
    var img = anchors[j].querySelector("img");
    links.push({ href: anchors[j].getAttribute("href") || "", alt: (img && img.getAttribute("alt")) || "" });
  }
  return { title: document.title, headerText: header ? header.innerText : "", metas: metas, links: links };
})()`;
const POST_SCRIPT = `(function () {${READ_METAS}
  var time = document.querySelector("time");
  return { metas: metas, firstTime: time ? time.getAttribute("datetime") : null };
})()`;

function driverFor(page: Page, closeContext: () => Promise<void>): PageDriver {
  return {
    async open(url) {
      const res = await page.goto(url, { waitUntil: "domcontentloaded" });
      return { status: res?.status() ?? 0, finalUrl: page.url() };
    },
    async declineCookies() {
      // The dialog is optional: absent within the wait means nothing to decline.
      await page
        .locator('button, [role="button"]')
        .filter({ hasText: DECLINE_COOKIES })
        .first()
        .click({ timeout: COOKIE_WAIT_MS })
        .catch(() => undefined);
    },
    async readProfile(): Promise<RawProfileDom> {
      // The app renders after load; an empty page is classified by the caller, so a timeout is not an error.
      await page.waitForSelector("header", { timeout: RENDER_WAIT_MS }).catch(() => undefined);
      await page
        .waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 5_000 })
        .catch(() => undefined);
      return {
        finalUrl: page.url(),
        ...(await page.evaluate<Omit<RawProfileDom, "finalUrl">>(PROFILE_SCRIPT)),
      };
    },
    async readPost(): Promise<RawPostDom> {
      await page
        .waitForSelector('meta[property="og:description"], time', {
          state: "attached",
          timeout: RENDER_WAIT_MS,
        })
        .catch(() => undefined);
      return {
        finalUrl: page.url(),
        ...(await page.evaluate<Omit<RawPostDom, "finalUrl">>(POST_SCRIPT)),
      };
    },
    close: closeContext,
  };
}

export function createChromiumLauncher(options: { executablePath?: string } = {}): BrowserLauncher {
  let browser: Promise<Browser> | undefined;

  // One browser for the launcher, started on first use and again if it died.
  function getBrowser(): Promise<Browser> {
    browser ??= import("playwright-core")
      .then(({ chromium }) =>
        chromium.launch({
          headless: true,
          ...(options.executablePath ? { executablePath: options.executablePath } : {}),
          args: ["--disable-dev-shm-usage"],
        }),
      )
      .then((b) => {
        b.on("disconnected", () => {
          browser = undefined;
        });
        return b;
      })
      .catch((err: unknown) => {
        browser = undefined;
        throw err;
      });
    return browser;
  }

  return {
    async newDriver() {
      // Default Chromium user agent on purpose: no other browser is impersonated.
      const context = await (
        await getBrowser()
      ).newContext({
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      try {
        // tsx/esbuild wrap named functions in a `__name` helper that does not exist in the page.
        await context.addInitScript("globalThis.__name = globalThis.__name || ((fn) => fn);");
        // Pictures are never needed (alt text is in the DOM): save the bandwidth.
        await context.route("**/*", (route) =>
          BLOCKED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
        );
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        return driverFor(page, () => context.close());
      } catch (err) {
        await context.close().catch(() => undefined);
        throw err;
      }
    },
    async close() {
      const current = browser;
      browser = undefined;
      await (await current?.catch(() => undefined))?.close().catch(() => undefined);
    },
  };
}
