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

describe("where the browser landed is checked, not only where it started", () => {
  const MOVED = "https://93.184.216.35"; // the brand's new domain, another public host
  function crawlLanding(landing: (url: string) => string, robots = "User-agent: *\nAllow: /\n") {
    const seen: string[] = [];
    const fetchImpl = (async (u: string) => {
      seen.push(u);
      return u.endsWith("/robots.txt") ? text(robots) : text("", "text/html");
    }) as unknown as typeof fetch;
    const landingFetcher: PageFetcher = {
      mode: "browser",
      fetchPage: async (u) => ({
        ...page(u),
        finalUrl: landing(u),
        navLinks: [`${MOVED}/servizi`],
      }),
      close: async () => undefined,
    };
    const run = () =>
      crawlSite({
        rootUrl: `${ROOT}/`,
        maxPages: 3,
        fetcher: landingFetcher,
        hostCheck: createHostCheck(),
        fetchImpl,
        userAgent: "ForgecyAudit/test",
        pageTimeoutMs: 5000,
        totalTimeoutMs: 20_000,
      });
    return { seen, run };
  }

  it("refuses a home page that landed on the local network", async () => {
    const { run } = crawlLanding(() => "http://169.254.169.254/latest/meta-data/");
    await expect(run()).rejects.toMatchObject({ code: "AUD-HOST-BLOCKED" });
  });

  it("skips a later page that landed on the local network", async () => {
    const { run } = crawlLanding((u) =>
      u.includes("/servizi") ? "http://192.168.1.1/servizi" : `${MOVED}/`,
    );
    const result = await run();
    expect(result.pages.map((p) => p.finalUrl)).toEqual([`${MOVED}/`]);
    expect(result.skipped).toMatchObject([{ code: "AUD-HOST-BLOCKED" }]);
  });

  it("follows a root that moved to a public domain: its pages and robots Sitemap are read", async () => {
    const { seen, run } = crawlLanding(
      (u) => (u.startsWith(ROOT) ? `${MOVED}/` : u),
      `User-agent: *\nAllow: /\nSitemap: ${MOVED}/sitemap.xml\n`,
    );
    const result = await run();
    expect(seen).toContain(`${MOVED}/sitemap.xml`);
    expect(result.pages.map((p) => p.finalUrl)).toEqual([`${MOVED}/`, `${MOVED}/servizi`]);
  });
});

describe("after a redirect to another origin, that origin's robots.txt applies", () => {
  const MOVED = "https://93.184.216.35";
  const THIRD = "https://93.184.216.36";
  function crawlMoved(input: {
    robots: Record<string, Response | undefined>;
    navLinks: string[];
    moved?: boolean;
    land?: (url: string) => string;
    maxPages?: number;
    sitemaps?: Record<string, string>;
  }) {
    const seen: string[] = [];
    const checked: string[] = [];
    const fetchImpl = (async (u: string) => {
      seen.push(u);
      if (u.endsWith("/robots.txt"))
        return input.robots[new URL(u).origin] ?? new Response("", { status: 404 });
      const sm = input.sitemaps?.[u];
      return sm ? text(sm, "application/xml") : new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const hostCheck = createHostCheck();
    const fetched: string[] = [];
    const movedFetcher: PageFetcher = {
      mode: "html",
      fetchPage: async (u) => {
        fetched.push(u);
        const finalUrl = input.land
          ? input.land(u)
          : input.moved !== false && u.startsWith(ROOT)
            ? `${MOVED}/`
            : u;
        return { ...page(u), finalUrl, navLinks: input.navLinks };
      },
      close: async () => undefined,
    };
    const run = () =>
      crawlSite({
        rootUrl: `${ROOT}/`,
        maxPages: input.maxPages ?? 5,
        fetcher: movedFetcher,
        hostCheck: async (u) => {
          checked.push(u);
          return hostCheck(u);
        },
        fetchImpl,
        userAgent: "ForgecyAudit/test",
        pageTimeoutMs: 5000,
        totalTimeoutMs: 20_000,
      });
    return { seen, checked, fetched, run };
  }
  const paths = (urls: string[]) => urls.map((u) => new URL(u).pathname);

  it("skips a page the landed origin disallows and reads the others", async () => {
    const { seen, checked, fetched, run } = crawlMoved({
      robots: { [MOVED]: text("User-agent: *\nDisallow: /servizi\n") },
      navLinks: [`${MOVED}/servizi`, `${MOVED}/contatti`],
    });
    const result = await run();
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/contatti"]);
    expect(result.skipped).toMatchObject([
      { url: `${MOVED}/servizi`, code: "AUD-ROBOTS-BLOCKED", reason: "Excluded by robots.txt" },
    ]);
    expect(fetched).not.toContain(`${MOVED}/servizi`);
    // Read through the guarded path: host-checked, then the pinned fetch.
    expect(checked).toContain(`${MOVED}/robots.txt`);
    expect(seen.filter((u) => u === `${MOVED}/robots.txt`)).toHaveLength(1);
  });

  it("reads the landed site when its robots.txt is missing", async () => {
    const { seen, run } = crawlMoved({
      robots: { [ROOT]: text("User-agent: *\nDisallow: /servizi\n") },
      navLinks: [`${MOVED}/servizi`],
    });
    const result = await run();
    expect(seen).toContain(`${MOVED}/robots.txt`);
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/servizi"]);
  });

  it("refuses a landed site whose robots.txt blocks everything", async () => {
    const { run } = crawlMoved({
      robots: { [MOVED]: text("User-agent: *\nDisallow: /\n") },
      navLinks: [],
    });
    await expect(run()).rejects.toMatchObject({ code: "AUD-ROBOTS-BLOCKED" });
  });

  it("still applies the root robots.txt when the origin did not change", async () => {
    const { seen, run } = crawlMoved({
      robots: { [ROOT]: text("User-agent: *\nDisallow: /servizi\n") },
      navLinks: [`${ROOT}/servizi`, `${ROOT}/contatti`],
      moved: false,
    });
    const result = await run();
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/contatti"]);
    expect(result.skipped).toMatchObject([{ url: `${ROOT}/servizi`, code: "AUD-ROBOTS-BLOCKED" }]);
    expect(seen.filter((u) => u.endsWith("/robots.txt"))).toEqual([`${ROOT}/robots.txt`]);
  });

  it("never reads a page, or a robots.txt, on a third host", async () => {
    const { seen, fetched, run } = crawlMoved({
      robots: {},
      navLinks: [`${THIRD}/servizi`, `${MOVED}/contatti`],
    });
    const result = await run();
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/contatti"]);
    expect([...seen, ...fetched].some((u) => u.startsWith(THIRD))).toBe(false);
  });

  it("uses the landed origin's sitemap.xml by default", async () => {
    const { seen, run } = crawlMoved({
      robots: {},
      navLinks: [],
      sitemaps: {
        [`${MOVED}/sitemap.xml`]: `<urlset><url><loc>${MOVED}/chi-siamo</loc></url></urlset>`,
      },
    });
    const result = await run();
    expect(seen).toContain(`${MOVED}/sitemap.xml`);
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/chi-siamo"]);
  });

  it("still tries the landed sitemap.xml when the root lists only an off-site one", async () => {
    const { seen, run } = crawlMoved({
      robots: { [ROOT]: text("User-agent: *\nSitemap: https://elsewhere.example.net/sm.xml\n") },
      navLinks: [],
      sitemaps: {
        [`${MOVED}/sitemap.xml`]: `<urlset><url><loc>${MOVED}/chi-siamo</loc></url></urlset>`,
      },
    });
    const result = await run();
    expect(seen.some((u) => u.includes("elsewhere.example.net"))).toBe(false);
    expect(paths(result.pages.map((p) => p.finalUrl))).toEqual(["/", "/chi-siamo"]);
  });

  it("does not keep a page that redirected to a path another origin's robots.txt disallows", async () => {
    const HTTP = ROOT.replace("https:", "http:");
    const { checked, seen, run } = crawlMoved({
      robots: { [HTTP]: text("User-agent: *\nDisallow: /private\n") },
      navLinks: [`${ROOT}/a`],
      land: (u) => (u === `${ROOT}/a` ? `${HTTP}/private` : u),
    });
    const result = await run();
    expect(result.pages.map((p) => p.finalUrl)).toEqual([`${ROOT}/`]);
    expect(result.skipped).toMatchObject([{ url: `${ROOT}/a`, code: "AUD-ROBOTS-BLOCKED" }]);
    expect(checked).toContain(`${HTTP}/robots.txt`);
    expect(seen).toContain(`${HTTP}/robots.txt`);
  });

  it("does not keep a page that redirected into a disallowed path of the same origin", async () => {
    const { run } = crawlMoved({
      robots: { [ROOT]: text("User-agent: *\nDisallow: /private\n") },
      navLinks: [`${ROOT}/a`],
      land: (u) => (u === `${ROOT}/a` ? `${ROOT}/private` : u),
    });
    const result = await run();
    expect(result.pages.map((p) => p.finalUrl)).toEqual([`${ROOT}/`]);
    expect(result.skipped).toMatchObject([{ url: `${ROOT}/a`, code: "AUD-ROBOTS-BLOCKED" }]);
  });

  it("reads the robots.txt of at most 4 origins per crawl", async () => {
    const ports = [8441, 8442, 8443, 8444, 8445, 8446, 8447];
    const { seen, fetched, run } = crawlMoved({
      robots: {},
      navLinks: ports.map((p) => `${ROOT}:${p}/x`),
      moved: false,
      maxPages: 10,
    });
    const result = await run();
    expect(seen.filter((u) => u.endsWith("/robots.txt")).length).toBeLessThanOrEqual(4);
    expect(result.pages).toHaveLength(4);
    expect(result.skipped).toHaveLength(4);
    expect(fetched).toHaveLength(4);
  });
});
