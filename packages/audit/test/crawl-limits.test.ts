import { describe, expect, it } from "vitest";
import { crawlSite } from "../src/crawl/crawler";
import {
  createHtmlFetcher,
  MAX_HTML_BYTES,
  type FetchedPage,
  type PageFetcher,
} from "../src/crawl/fetcher";
import { createHostCheck } from "../src/url";

const ROOT = "https://93.184.216.34"; // IP literal: the host check needs no DNS
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const text = (body: string, type = "text/plain") =>
  new Response(body, { status: 200, headers: { "content-type": type } });

function page(url: string): FetchedPage {
  return {
    url,
    finalUrl: url,
    status: 200,
    title: "t",
    data: {} as FetchedPage["data"],
    links: [],
    navLinks: [],
    colors: [],
    fonts: [],
    requiresLogin: false,
  };
}
const fetcher: PageFetcher = {
  mode: "html",
  fetchPage: async (u) => page(u),
  close: async () => undefined,
};

function crawlWith(routes: (url: string) => Response) {
  const seen: string[] = [];
  const fetchImpl = (async (u: string) => {
    seen.push(u);
    return routes(u);
  }) as unknown as typeof fetch;
  const hostCheck = createHostCheck();
  const run = () =>
    crawlSite({
      rootUrl: `${ROOT}/`,
      maxPages: 3,
      fetcher,
      hostCheck,
      fetchImpl,
      userAgent: "ForgecyAudit/test",
      pageTimeoutMs: 5000,
      totalTimeoutMs: 20_000,
    });
  return { seen, run };
}

describe("robots.txt and sitemap fetches validate every redirect hop", () => {
  it("does not follow a robots.txt redirect to a hex-mapped metadata address", async () => {
    const { seen, run } = crawlWith((u) =>
      u.endsWith("/robots.txt")
        ? redirect("http://[::ffff:a9fe:a9fe]/latest/meta-data")
        : text("", "text/html"),
    );
    const result = await run();
    expect(result.robots.found).toBe(false);
    expect(seen.some((u) => u.includes("a9fe") || u.includes("169.254"))).toBe(false);
  });

  it("does not follow a sitemap.xml redirect to the local network", async () => {
    const { seen, run } = crawlWith((u) =>
      u.endsWith("/sitemap.xml")
        ? redirect("http://10.0.0.1/admin")
        : text("User-agent: *\nAllow: /\n"),
    );
    await run();
    expect(seen.some((u) => u.includes("10.0.0.1"))).toBe(false);
  });

  it("ignores Sitemap: lines that point at another site or at private addresses", async () => {
    const { seen, run } = crawlWith((u) =>
      u.endsWith("/robots.txt")
        ? text(
            "User-agent: *\nAllow: /\nSitemap: http://169.254.169.254/sitemap.xml\nSitemap: https://elsewhere.example.net/sitemap.xml\n",
          )
        : text("", "text/html"),
    );
    await run();
    expect(
      seen.some((u) => u.includes("169.254.169.254") || u.includes("elsewhere.example.net")),
    ).toBe(false);
  });

  it("still reads a same-site sitemap and its index children", async () => {
    const { seen, run } = crawlWith((u) => {
      if (u.endsWith("/robots.txt"))
        return text(`User-agent: *\nAllow: /\nSitemap: ${ROOT}/sitemap.xml\n`);
      if (u.endsWith("/sitemap.xml"))
        return text(
          `<sitemapindex><sitemap><loc>${ROOT}/sm-1.xml</loc></sitemap></sitemapindex>`,
          "application/xml",
        );
      if (u.endsWith("/sm-1.xml"))
        return text(`<urlset><url><loc>${ROOT}/servizi</loc></url></urlset>`, "application/xml");
      return text("", "text/html");
    });
    await run();
    expect(seen).toContain(`${ROOT}/sm-1.xml`);
  });

  it("reads at most 500 kB of an endless robots.txt", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new TextEncoder().encode("# ".padEnd(64 * 1024, "x") + "\n"));
      },
    });
    const { run } = crawlWith((u) =>
      u.endsWith("/robots.txt") ? new Response(endless, { status: 200 }) : text("", "text/html"),
    );
    const result = await run();
    expect(result.robots.found).toBe(true);
    expect(pulls).toBeLessThan(40);
  });
});

describe("createHtmlFetcher", () => {
  const hostCheck = createHostCheck();

  it("caps the HTML it reads", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new TextEncoder().encode("<p>x</p>".repeat(8192)));
      },
    });
    const fetchImpl = (async () =>
      new Response(endless, {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;
    const f = createHtmlFetcher({ userAgent: "t", hostCheck, fetchImpl });
    const p = await f.fetchPage(`${ROOT}/`, { timeoutMs: 5000, screenshots: false });
    expect(p.status).toBe(200);
    expect(pulls).toBeLessThanOrEqual(Math.ceil(MAX_HTML_BYTES / (8 * 8192)) + 4);
  }, 30_000);

  it("maps a private redirect to AUD-HOST-BLOCKED and a redirect loop to SOURCE-UNAVAILABLE", async () => {
    const toPrivate = (async () => redirect("http://[::ffff:7f00:1]/")) as unknown as typeof fetch;
    await expect(
      createHtmlFetcher({ userAgent: "t", hostCheck, fetchImpl: toPrivate }).fetchPage(`${ROOT}/`, {
        timeoutMs: 5000,
        screenshots: false,
      }),
    ).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
    const loop = (async () => redirect("/again")) as unknown as typeof fetch;
    await expect(
      createHtmlFetcher({ userAgent: "t", hostCheck, fetchImpl: loop }).fetchPage(`${ROOT}/`, {
        timeoutMs: 5000,
        screenshots: false,
      }),
    ).rejects.toMatchObject({ code: "SOURCE-UNAVAILABLE" });
  });
});
