import { CrawlError } from "@forgecy/audit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserFetcher: vi.fn(),
  createHtmlFetcher: vi.fn(),
  crawlSite: vi.fn(),
}));

vi.mock("@forgecy/audit/crawl/browser", () => ({
  createBrowserFetcher: mocks.createBrowserFetcher,
  resolveChromiumPath: () => undefined,
}));
vi.mock("@forgecy/audit/crawl/fetcher", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createHtmlFetcher: mocks.createHtmlFetcher,
}));
vi.mock("@forgecy/audit/crawl/crawler", async (importOriginal) => {
  const actual = await importOriginal<{ crawlSite: (...args: never[]) => unknown }>();
  mocks.crawlSite.mockImplementation(actual.crawlSite);
  return { ...actual, crawlSite: mocks.crawlSite };
});

const { runWebsiteCrawl } = await import("../src/crawl");
import type { ImportContext, ImportDeps } from "../src/import/run";

const fetcher = (mode: "browser" | "html") => ({
  mode,
  fetchPage: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
});

function setup(url: string) {
  const sets: Array<Record<string, unknown>> = [];
  const source = { id: "s1", clientId: "c1", removedAt: null, url };
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([source]) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  const run = () =>
    runWebsiteCrawl({ db } as unknown as ImportDeps, {} as ImportContext, {
      clientId: "c1",
      sourceId: "s1",
    });
  return { sets, run };
}

const noBrowser = () =>
  new CrawlError("AUD-BROWSER-UNAVAILABLE", "no chromium", { key: "audit.stored.crawl.hostLocal" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWebsiteCrawl browser or fallback", () => {
  it("falls back to the markup fetcher when the browser is unavailable, and closes it", async () => {
    const html = fetcher("html");
    mocks.createBrowserFetcher.mockRejectedValue(noBrowser());
    mocks.createHtmlFetcher.mockReturnValue(html);
    mocks.crawlSite.mockResolvedValueOnce({ pages: [], skipped: [], stoppedEarly: false });

    const { run, sets } = setup("https://example.com");
    const result = await run();

    expect(mocks.createHtmlFetcher).toHaveBeenCalledOnce();
    expect(mocks.crawlSite.mock.calls[0]![0].fetcher).toBe(html);
    expect(mocks.crawlSite.mock.calls[0]![0]).toMatchObject({
      brandProbe: true,
      screenshots: false,
    });
    expect(html.close).toHaveBeenCalledOnce();
    // No page had text: nothing to analyze.
    expect(result).toMatchObject({ pages: 0, proposals: 0, discarded: 0 });
    expect(sets.at(-1)).toMatchObject({ status: "failed", visual: null });
  });

  it("still refuses a blocked host after the fallback, clearing pages and visual data", async () => {
    const html = fetcher("html");
    mocks.createBrowserFetcher.mockRejectedValue(
      new CrawlError("AUD-HOST-BLOCKED", "blocked", { key: "audit.stored.crawl.hostLocal" }),
    );
    mocks.createHtmlFetcher.mockReturnValue(html);

    const { run, sets } = setup("http://127.0.0.1/");
    const result = await run();

    expect(mocks.createHtmlFetcher).toHaveBeenCalledOnce();
    expect(html.fetchPage).not.toHaveBeenCalled();
    expect(result.pages).toBe(0);
    expect(sets.at(-1)).toMatchObject({ status: "failed", pages: [], visual: null });
    expect(html.close).toHaveBeenCalledOnce();
  });

  it("closes the browser when the crawl fails inside it", async () => {
    const browser = fetcher("browser");
    mocks.createBrowserFetcher.mockResolvedValue(browser);
    mocks.crawlSite.mockRejectedValueOnce(new Error("boom"));

    const { run, sets } = setup("https://example.com");
    const result = await run();

    expect(mocks.createHtmlFetcher).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(result.detail).toBe("boom");
    expect(sets.at(-1)).toMatchObject({ status: "failed", pages: [], visual: null });
  });

  it("does not hide an unexpected browser error behind the fallback", async () => {
    mocks.createBrowserFetcher.mockRejectedValue(new Error("disk full"));
    const { run, sets } = setup("https://example.com");
    const result = await run();
    expect(result.detail).toBe("disk full");
    expect(mocks.createHtmlFetcher).not.toHaveBeenCalled();
    expect(sets.at(-1)).toMatchObject({ status: "failed", pages: [], visual: null });
  });
});
