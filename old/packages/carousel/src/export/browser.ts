import { existsSync } from "node:fs";
import { loadToolEnv } from "@forgecy/core";
import { type Browser, chromium } from "playwright-core";

/**
 * Chromium for the export worker. Flags keep the raster stable between runs: no GPU,
 * no LCD subpixel text, fixed sRGB color profile, no font hinting.
 */
const ARGS = [
  "--disable-gpu",
  // Docker gives /dev/shm only 64 MB.
  "--disable-dev-shm-usage",
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
  "--disable-extensions",
  "--no-first-run",
  "--mute-audio",
];

/** Explicit binary (FORGECY_CHROMIUM_PATH), else the browser Playwright installed (Docker image). */
export function chromiumExecutable(): string | undefined {
  const p = loadToolEnv().FORGECY_CHROMIUM_PATH;
  return p && existsSync(p) ? p : undefined;
}

export async function launchRenderBrowser(): Promise<Browser> {
  const executablePath = chromiumExecutable();
  return chromium.launch({
    headless: true,
    args: ARGS,
    ...(executablePath ? { executablePath } : {}),
  });
}

/** One browser per worker process, started on first use and restarted if it crashed. */
export function sharedRenderBrowser() {
  let current: Promise<Browser> | undefined;
  return {
    async get(): Promise<Browser> {
      if (current) {
        const b = await current.catch(() => undefined);
        if (b?.isConnected()) return b;
      }
      current = launchRenderBrowser();
      return current;
    },
    async close(): Promise<void> {
      const b = await current?.catch(() => undefined);
      current = undefined;
      await b?.close();
    },
  };
}
