import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite } from "../src/crawl/crawler";
import { createHtmlFetcher } from "../src/crawl/fetcher";
import { CrawlError } from "../src/errors";
import { createHostCheck } from "../src/url";

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title}"></head><body>${body}</body></html>`;

// Italian paths for services and contacts on purpose: the crawler ranks Italian path stems.
const routes: Record<string, { status?: number; type?: string; body: string; location?: string }> =
  {
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n" },
    "/": {
      body: page(
        "Forno Rossi",
        `<header><nav><a href="/servizi">Services</a><a href="/contatti">Contact</a><a href="/private">Area</a><a href="/account">Log in</a></nav></header>
       <h1>Fresh bread every day</h1><a href="/old">Old</a><a href="/broken">Broken</a>`,
      ),
    },
    "/servizi": { body: page("Services", "<h1>Catering</h1>") },
    "/contatti": { body: page("Contact", "<h1>Write to us</h1><form><input name=email></form>") },
    "/private": { body: page("Private", "<h1>No</h1>") },
    "/account": { body: page("Log in", '<form><input type="password"></form>') },
    // Same server under another host name: a different site for the crawler.
    "/old": { status: 301, location: "http://localhost:{port}/servizi", body: "" },
    "/broken": { status: 500, body: "boom" },
  };

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const route = routes[new URL(req.url ?? "/", "http://x").pathname];
    if (!route) {
      res.writeHead(404, { "content-type": "text/html" }).end("not found");
      return;
    }
    res
      .writeHead(route.status ?? 200, {
        "content-type": route.type ?? "text/html; charset=utf-8",
        ...(route.location
          ? {
              location: route.location.replace(
                "{port}",
                String((server.address() as AddressInfo).port),
              ),
            }
          : {}),
      })
      .end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function options(allowPrivate: boolean) {
  const hostCheck = createHostCheck({ allowPrivate });
  return {
    rootUrl: `${base}/`,
    maxPages: 10,
    fetcher: createHtmlFetcher({ userAgent: "ForgecyAudit/test", hostCheck }),
    hostCheck,
    userAgent: "ForgecyAudit/test",
    pageTimeoutMs: 5000,
    totalTimeoutMs: 20_000,
  };
}

describe("crawlSite", () => {
  it("refuses local hosts by default", async () => {
    await expect(crawlSite(options(false))).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
  });

  it("reads the site within robots.txt and records skipped pages", async () => {
    const steps: string[] = [];
    const result = await crawlSite({
      ...options(true),
      onProgress: (p) => {
        steps.push(`${p.step}:${p.status}`);
      },
    });
    expect(result.robots).toEqual({ found: true, blockedAll: false });
    expect(result.pages.map((p) => new URL(p.finalUrl).pathname).sort()).toEqual([
      "/",
      "/contatti",
      "/servizi",
    ]);
    const skipped = Object.fromEntries(
      result.skipped.map((s) => [new URL(s.url).pathname, s.reason]),
    );
    expect(skipped).toMatchObject({
      "/private": "Excluded by robots.txt",
      "/old": "Redirects to another website",
      "/broken": "Error 500",
    });
    // Login pages are never even picked.
    expect(skipped["/account"]).toBeUndefined();
    expect(steps).toContain("robots:completed");
    expect(steps).toContain("screenshots:skipped");
  });

  it("does not bypass a robots.txt that blocks everything", async () => {
    const original = routes["/robots.txt"]!;
    routes["/robots.txt"] = { type: "text/plain", body: "User-agent: *\nDisallow: /\n" };
    try {
      const err = await crawlSite(options(true)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CrawlError);
      expect((err as CrawlError).code).toBe("AUD-ROBOTS-BLOCKED");
    } finally {
      routes["/robots.txt"] = original;
    }
  });

  it("keeps the pages already read when cancelled", async () => {
    const result = await crawlSite({ ...options(true), isCancelled: async () => true });
    expect(result.stoppedEarly).toBe("cancelled");
    expect(result.pages).toHaveLength(1);
  });
});
