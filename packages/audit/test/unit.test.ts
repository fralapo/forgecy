import { describe, expect, it } from "vitest";
import { quoteFound } from "../src/ai/agents";
import { buildIndex, confidenceOf, verifyEvidence } from "../src/ai/evidence";
import { canonicalUrl, parseSitemap, pickPages } from "../src/crawl/crawler";
import { isBusinessType, technicalChecks } from "../src/crawl/extract";
import { extractFromHtml, structuredDataTypes, type FetchedPage } from "../src/crawl/fetcher";
import { computeChannelMetrics, type PostRow } from "../src/social/metrics";
import {
  detectDelimiter,
  interpretRows,
  parseCsv,
  parseDateCell,
  parseStrictNumber,
  suggestMapping,
} from "../src/social/table";
import {
  createHostCheck,
  domainOf,
  isPlatformUrl,
  isPrivateAddress,
  normalizeSiteUrl,
  socialChannelOf,
} from "../src/url";

describe("url", () => {
  it("normalizes what a person types", () => {
    expect(normalizeSiteUrl("Example.it/chi-siamo#team")).toBe("https://example.it/chi-siamo");
    expect(normalizeSiteUrl("http://user:pw@example.it")).toBe("http://example.it/");
    expect(normalizeSiteUrl("ftp://example.it")).toBeNull();
    expect(normalizeSiteUrl("not a site")).toBeNull();
    expect(normalizeSiteUrl("")).toBeNull();
  });

  it("compares domains without www", () => {
    expect(domainOf("https://www.Example.it/x")).toBe("example.it");
    expect(domainOf("nope")).toBeNull();
  });

  it("recognizes social profiles by domain only", () => {
    expect(isPlatformUrl("instagram", "instagram.com/forgecy")).toBe(true);
    expect(isPlatformUrl("instagram", "https://evil-instagram.com/x")).toBe(false);
    expect(isPlatformUrl("facebook", "https://fb.com/x")).toBe(true);
    expect(socialChannelOf("https://www.linkedin.com/company/x")).toBe("linkedin");
    expect(socialChannelOf("https://example.it")).toBeNull();
  });

  it("flags local network addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.20.0.1", "169.254.169.254"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });

  it("refuses local hosts unless allowed", async () => {
    const check = createHostCheck();
    expect(await check("http://127.0.0.1:3000/")).toBe(false);
    expect(await check("http://localhost/")).toBe(false);
    expect(await check("http://[::1]/")).toBe(false);
    expect(await check("file:///etc/passwd")).toBe(false);
    expect(await check("https://93.184.216.34/")).toBe(true);
    expect(await createHostCheck({ allowPrivate: true })("http://127.0.0.1/")).toBe(true);
  });
});

// Italian paths on purpose: the page ranking matches Italian and English path stems.
describe("page selection", () => {
  it("canonicalizes urls", () => {
    expect(canonicalUrl("https://Example.it/servizi/?utm=1#x")).toBe("https://example.it/servizi");
  });

  it("ranks brand pages and skips files, logins and other sites", () => {
    const pages = pickPages({
      home: "https://example.it/",
      navLinks: [
        "https://example.it/blog",
        "https://example.it/contatti",
        "https://example.it/servizi",
        "https://example.it/login",
      ],
      links: [
        "https://other.it/servizi",
        "https://example.it/listino.pdf",
        "https://example.it/chi-siamo",
      ],
      sitemapUrls: ["https://www.example.it/prodotti"],
      maxPages: 5,
      focus: "site",
    });
    expect(pages).toEqual([
      "https://example.it/",
      "https://example.it/contatti",
      "https://example.it/servizi",
      "https://example.it/chi-siamo",
      "https://www.example.it/prodotti",
    ]);
  });

  it("keeps competitor reads to services and contacts", () => {
    const pages = pickPages({
      home: "https://rival.it/",
      navLinks: ["https://rival.it/blog", "https://rival.it/servizi", "https://rival.it/contatti"],
      links: [],
      sitemapUrls: [],
      maxPages: 3,
      focus: "competitor",
    });
    expect(pages).toEqual([
      "https://rival.it/",
      "https://rival.it/servizi",
      "https://rival.it/contatti",
    ]);
  });

  it("parses sitemaps and sitemap indexes", () => {
    expect(
      parseSitemap("<urlset><url><loc> https://a.it/x?a=1&amp;b=2 </loc></url></urlset>"),
    ).toEqual({ urls: ["https://a.it/x?a=1&b=2"], sitemaps: [] });
    expect(
      parseSitemap(
        "<sitemapindex><sitemap><loc>https://a.it/s1.xml</loc></sitemap></sitemapindex>",
      ),
    ).toEqual({
      urls: [],
      sitemaps: ["https://a.it/s1.xml"],
    });
  });

  it("extracts menu links, headings and login forms from markup", () => {
    const page = extractFromHtml(
      `<html><head><title>Forno Rossi</title></head><body>
        <nav><a href="/servizi">Servizi</a></nav>
        <h1>Fresh bread every day</h1><a href="https://other.it">x</a>
        <form><input type="password"></form></body></html>`,
      "https://forno.it/",
    );
    expect(page.title).toBe("Forno Rossi");
    expect(page.navLinks).toContain("https://forno.it/servizi");
    expect(page.requiresLogin).toBe(true);
  });

  it("reads schema.org types from JSON-LD, @graph included, and skips invalid blocks", () => {
    const html = `<head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Bakery","LocalBusiness"]}]}</script>
      <script type='application/ld+json'>{ not json</script>
      <script type="application/ld+json">[{"@type":"https://schema.org/BreadcrumbList"}]</script></head>`;
    expect(structuredDataTypes(html).sort()).toEqual([
      "Bakery",
      "BreadcrumbList",
      "LocalBusiness",
      "WebSite",
    ]);
    expect(extractFromHtml(html, "https://forno.it/").data.structuredDataTypes).toContain(
      "LocalBusiness",
    );
  });

  it("recognizes the types that describe the business", () => {
    for (const t of [
      "Organization",
      "LocalBusiness",
      "ProfessionalService",
      "HomeAndConstructionBusiness",
      "Store",
      "Bakery",
    ])
      expect(isBusinessType(t), t).toBe(true);
    for (const t of ["WebSite", "WebPage", "BreadcrumbList", "Service", "FAQPage"])
      expect(isBusinessType(t), t).toBe(false);
  });

  it("checks structured data and AI crawlers' access", () => {
    const page = (path: string, types: string[]): FetchedPage => ({
      url: `https://forno.it${path}`,
      finalUrl: `https://forno.it${path}`,
      status: 200,
      title: "",
      data: { structuredDataTypes: types },
      links: [],
      navLinks: [],
      colors: [],
      fonts: [],
      requiresLogin: false,
    });
    const byKey = (checks: ReturnType<typeof technicalChecks>) =>
      Object.fromEntries(checks.map((c) => [c.key, c]));

    const bare = byKey(
      technicalChecks([page("/", ["WebSite"])], { aiCrawlersBlocked: ["GPTBot", "ClaudeBot"] }),
    );
    expect(bare.structured_data).toMatchObject({ ok: false, pages: ["/"] });
    expect(bare.ai_crawlers).toMatchObject({ ok: false, pages: ["/robots.txt"] });
    expect(bare.ai_crawlers!.detail).toContain("GPTBot, ClaudeBot");

    const good = byKey(
      technicalChecks([page("/", ["Bakery"]), page("/chi-siamo", [])], { aiCrawlersBlocked: [] }),
    );
    expect(good.structured_data).toMatchObject({ ok: true, pages: [] });
    expect(good.ai_crawlers!.ok).toBe(true);
    expect(byKey(technicalChecks([page("/", [])])).ai_crawlers).toBeUndefined();
  });
});

describe("tables", () => {
  it("parses CSV with quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
    expect(detectDelimiter("data;like;commenti")).toBe(";");
  });

  it("reads numbers strictly and never estimates", () => {
    expect(parseStrictNumber("1.234")).toBe(1234);
    expect(parseStrictNumber("1,5")).toBe(1.5);
    expect(parseStrictNumber("1.234,5")).toBe(1234.5);
    expect(parseStrictNumber("12%")).toBe(12);
    expect(parseStrictNumber("circa 2.000")).toBeNull();
    expect(parseStrictNumber("1k-2k")).toBeNull();
    expect(parseStrictNumber("~300")).toBeNull();
  });

  it("reads dates in the chosen format and refuses impossible ones", () => {
    expect(parseDateCell("03/04/2026", "dd/mm/yyyy")).toBe("2026-04-03");
    expect(parseDateCell("03/04/2026", "mm/dd/yyyy")).toBe("2026-03-04");
    expect(parseDateCell("2026-04-03T10:00", "dd/mm/yyyy")).toBe("2026-04-03");
    expect(parseDateCell("31/02/2026", "dd/mm/yyyy")).toBeNull();
    expect(parseDateCell("03/04/2026", "yyyy-mm-dd")).toBeNull();
  });

  it("maps columns and skips rows without a date", () => {
    // Italian headers on purpose: exported analytics files are often in Italian.
    const mapping = suggestMapping(["Data", "Tipo", "Mi piace", "Commenti", "Colonna X"]);
    expect(mapping).toEqual({ 0: "date", 1: "post_type", 2: "likes", 3: "comments", 4: "ignore" });
    const result = interpretRows(
      {
        rows: [
          ["01/09/2026", "Reel", "1.200", "30", "?"],
          ["yesterday", "Post", "10", "1", ""],
        ],
      },
      mapping,
      "dd/mm/yyyy",
    );
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        postedOn: "2026-09-01",
        postType: "Reel",
        metrics: { likes: 1200, comments: 30 },
      },
    ]);
    expect(result.invalid).toEqual([{ rowNumber: 3, reason: "Invalid date" }]);
  });
});

describe("channel metrics", () => {
  const today = new Date("2026-10-01T12:00:00Z");
  const card = (cards: ReturnType<typeof computeChannelMetrics>, key: string) =>
    cards.find((c) => c.key === key)!;

  it("shows missing values as not available, never zero", () => {
    const cards = computeChannelMetrics({ channel: "instagram", metrics: [], posts: [], today });
    expect(card(cards, "followers")).toMatchObject({ value: null, display: "Unavailable" });
    expect(card(cards, "frequency").value).toBeNull();
    expect(card(cards, "interaction_rate").value).toBeNull();
  });

  it("computes frequency from real dates and the rate only from one source", () => {
    const posts: PostRow[] = [
      { postedOn: "2026-09-29", metrics: { likes: 90, comments: 10 } },
      { postedOn: "2026-09-20", metrics: { interactions: 300 } },
      { postedOn: "2026-06-01", metrics: { likes: 20 } },
    ];
    const manual = computeChannelMetrics({
      channel: "instagram",
      metrics: [
        {
          metric: "followers",
          value: 1000,
          observedOn: "2026-09-30",
          source: "provided_by_prospect",
        },
      ],
      posts,
      today,
    });
    expect(card(manual, "frequency").value).toBe(0.5);
    expect(card(manual, "avg_interactions").value).toBe(140);
    expect(card(manual, "interaction_rate").value).toBeNull();

    const imported = computeChannelMetrics({
      channel: "instagram",
      metrics: [
        { metric: "followers", value: 1000, observedOn: "2026-09-30", source: "file_import" },
      ],
      posts,
      today,
    });
    expect(card(imported, "interaction_rate").value).toBeCloseTo(14);
  });
});

describe("evidence", () => {
  const index = buildIndex([
    [
      "P1",
      {
        type: "page",
        label: "Home",
        sourceId: "s1",
        text: "The best bread in Milan, since 1950.",
      },
    ],
    ["P2", { type: "page", label: "Contact", sourceId: "s2", text: "Write to us" }],
    ["CHECK:h1", { type: "technical", label: "H1 heading" }],
  ]);

  it("matches quotes verbatim modulo spacing", () => {
    expect(quoteFound("best  bread", "The best bread")).toBe(true);
    expect(quoteFound("better bread", "The best bread")).toBe(false);
  });

  it("drops invented refs and unverified quotes", () => {
    const v = verifyEvidence(
      [
        { ref: "p1", quote: "best bread in Milan" },
        { ref: "P2", quote: "Call us now" },
        { ref: "P9" },
        { ref: "check:H1" },
      ],
      index,
    );
    expect(v.dropped).toEqual(["P9"]);
    expect(v.evidence.map((e) => e.type)).toEqual(["quote", "page", "technical"]);
    expect(v.evidence[1]).not.toHaveProperty("quote");
    expect(v.distinct).toBe(3);
    expect(confidenceOf(v).confidence).toBe("high");
  });

  it("derives confidence from distinct elements", () => {
    const one = verifyEvidence([{ ref: "P1" }, { ref: "P1", quote: "since 1950" }], index);
    expect(one.distinct).toBe(1);
    expect(confidenceOf(one).confidence).toBe("low");
  });
});
