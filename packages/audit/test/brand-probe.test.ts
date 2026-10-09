import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveChromiumPath } from "../src/crawl/browser";
import {
  buildSiteProbe,
  parseJsonLdOrganization,
  rankLogoCandidates,
  toHex,
  type ProbeImage,
  type RawProbe,
} from "../src/crawl/brand-probe";

const img = (over: Partial<ProbeImage>): ProbeImage => ({
  url: "https://example.com/a.png",
  alt: "",
  w: 200,
  h: 80,
  inHeader: false,
  inFooter: false,
  repeats: 1,
  source: "img",
  ...over,
});

describe("toHex", () => {
  it("normalizes colors to lowercase #rrggbb", () => {
    expect(toHex("rgb(0, 0, 255)")).toBe("#0000ff");
    expect(toHex("rgb(0 0 255)")).toBe("#0000ff");
    expect(toHex("rgba(29, 58, 138, 1)")).toBe("#1d3a8a");
    expect(toHex("#abc")).toBe("#aabbcc");
    expect(toHex("#1D3A8A")).toBe("#1d3a8a");
    expect(toHex("hsl(240, 100%, 50%)")).toBe("#0000ff");
    expect(toHex("  #FFF ")).toBe("#ffffff");
  });

  it("returns null for transparent, translucent and unparsable colors", () => {
    expect(toHex("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(toHex("rgba(0, 0, 0, 0)")).toBeNull();
    expect(toHex("#0000ff80")).toBeNull();
    expect(toHex("transparent")).toBeNull();
    expect(toHex("var(--x)")).toBeNull();
    expect(toHex("")).toBeNull();
  });
});

describe("parseJsonLdOrganization", () => {
  const page = (json: unknown) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head></html>`;

  it("finds an Organization in @graph, resolves the logo and keeps http(s) sameAs", () => {
    const org = parseJsonLdOrganization(
      page({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "Ignored" },
          {
            "@type": ["Organization", "Thing"],
            name: "Acme",
            description: "Anvils",
            logo: "/img/logo.png",
            sameAs: ["https://instagram.com/acme", "mailto:a@b.c", "javascript:x", "ftp://x/y"],
          },
        ],
      }),
      "https://acme.test/about",
    );
    expect(org).toEqual({
      name: "Acme",
      description: "Anvils",
      logo: "https://acme.test/img/logo.png",
      sameAs: ["https://instagram.com/acme"],
    });
  });

  it("reads LocalBusiness with an ImageObject logo, also by @id reference", () => {
    const direct = parseJsonLdOrganization(
      page({ "@type": "LocalBusiness", name: "Bar", logo: { url: "https://cdn.test/l.svg" } }),
      "https://bar.test/",
    );
    expect(direct?.logo).toBe("https://cdn.test/l.svg");
    const byId = parseJsonLdOrganization(
      page({
        "@graph": [
          { "@type": "Organization", name: "Yoast Co", logo: { "@id": "https://y.test/#logo" } },
          { "@type": "ImageObject", "@id": "https://y.test/#logo", url: "/wp/logo.webp" },
        ],
      }),
      "https://y.test/",
    );
    expect(byId?.logo).toBe("https://y.test/wp/logo.webp");
    expect(byId?.sameAs).toEqual([]);
  });

  it("returns undefined without an organization or with broken JSON-LD", () => {
    expect(parseJsonLdOrganization("<html></html>", "https://x.test/")).toBeUndefined();
    expect(
      parseJsonLdOrganization(page({ "@type": "Product" }), "https://x.test/"),
    ).toBeUndefined();
    expect(
      parseJsonLdOrganization(
        '<script type="application/ld+json">{nope</script>',
        "https://x.test/",
      ),
    ).toBeUndefined();
  });

  it("drops a logo that is not http(s)", () => {
    const org = parseJsonLdOrganization(
      page({ "@type": "Organization", name: "A", logo: "data:image/png;base64,AAAA" }),
      "https://x.test/",
    );
    expect(org?.logo).toBeUndefined();
  });
});

describe("rankLogoCandidates", () => {
  it("ranks a header logo above a 1200px hero", () => {
    const hero = img({ url: "https://e.com/hero.jpg", w: 1200, h: 600 });
    const logo = img({ url: "https://e.com/Logo.svg", alt: "Acme logo", inHeader: true });
    const ranked = rankLogoCandidates([hero, logo]);
    expect(ranked[0]).toBe(logo);
    expect(ranked).not.toContain(hero);
  });

  it("excludes 1x1 and oversized images and returns [] when nothing qualifies", () => {
    expect(rankLogoCandidates([img({ w: 1, h: 1, inHeader: true })])).toEqual([]);
    expect(rankLogoCandidates([img({ w: 1600, h: 400, inHeader: true })])).toEqual([]);
    expect(rankLogoCandidates([])).toEqual([]);
  });

  it("scores footer-only, jsonld and og sources", () => {
    const footer = img({ url: "https://e.com/logo-f.png", inFooter: true });
    const jsonld = img({ url: "https://e.com/x.png", source: "jsonld", w: 0, h: 0 });
    const og = img({ url: "https://e.com/og.png", source: "og", w: 0, h: 0 });
    const plain = img({ url: "https://e.com/photo.png" });
    // footer: +4 logo, -3 footer = 1; jsonld: +2; og: +1; plain: 0 (dropped)
    expect(rankLogoCandidates([footer, og, plain, jsonld])).toEqual([jsonld, footer, og]);
  });
});

describe("buildSiteProbe", () => {
  const raw: RawProbe = {
    cssVars: [
      { name: "--brand-primary", color: "rgb(29, 58, 138)" },
      { name: "--shadow", color: "rgba(0, 0, 0, 0.2)" },
    ],
    themeColor: "#1D3A8A",
    buttonColors: [
      { color: "rgb(105, 114, 125)", role: "bg", weight: 900 },
      { color: "rgba(0, 0, 0, 0)", role: "bg", weight: 50 },
    ],
    fonts: [
      { family: "Arial", roles: ["body"], loaded: false },
      { family: "Inter", roles: ["headings"], loaded: true },
    ],
    logos: [img({ url: "data:image/png;base64,AAAA", inHeader: true })],
    images: [
      img({ url: "https://e.com/a.jpg" }),
      img({ url: "blob:https://e.com/1" }),
      img({ url: "data:image/gif;base64,R0lG" }),
    ],
  };

  it("normalizes colors, drops system fonts and non-http(s) images, adds the JSON-LD logo", () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"A","logo":"/l.png"}</script>`;
    const probe = buildSiteProbe(raw, html, "https://e.com/");
    expect(probe.cssVars).toEqual([{ name: "--brand-primary", hex: "#1d3a8a" }]);
    expect(probe.themeColor).toBe("#1d3a8a");
    expect(probe.buttonColors).toEqual([{ hex: "#69727d", role: "bg", weight: 900 }]);
    expect(probe.fonts).toEqual([{ family: "Inter", roles: ["headings"], loaded: true }]);
    expect(probe.images.map((i) => i.url)).toEqual(["https://e.com/a.jpg"]);
    expect(probe.logos.map((l) => l.url)).toEqual(["https://e.com/l.png"]);
    expect(probe.organization?.name).toBe("A");
  });

  it("caps every list", () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    const probe = buildSiteProbe(
      {
        cssVars: many.map((i) => ({ name: `--c${i}`, color: "#112233" })),
        buttonColors: many.map((i) => ({
          color: `rgb(${i}, 0, 0)`,
          role: "bg" as const,
          weight: i,
        })),
        fonts: many.map((i) => ({ family: `F${i}`, roles: ["body" as const], loaded: true })),
        logos: many.map((i) => img({ url: `https://e.com/logo${i}.png`, inHeader: true })),
        images: many.map((i) => img({ url: `https://e.com/i${i}.png` })),
      },
      "",
      "https://e.com/",
    );
    expect(probe.cssVars).toHaveLength(40);
    expect(probe.buttonColors).toHaveLength(24);
    expect(probe.fonts).toHaveLength(12);
    expect(probe.logos).toHaveLength(8);
    expect(probe.images).toHaveLength(60);
  });
});

// Real browser: runs only where a Chromium is available (FORGECY_CHROMIUM_PATH or
// PLAYWRIGHT_BROWSERS_PATH), like the worker image.
const chromium = resolveChromiumPath();

const PAGE = `<!doctype html><html><head><title>Acme</title>
<meta name="theme-color" content="#1d3a8a">
<script type="application/ld+json">{"@type":"Organization","name":"Acme","sameAs":["https://instagram.com/acme"]}</script>
<style>
:root{--brand-primary:#1d3a8a;--brand-accent:orange;--e-global-color-primary:#6EC1E4;--spacing:12px}
body{font-family:Arial,sans-serif;margin:0}
.elementor-button{background-color:#69727d;color:#fff;font-family:Arial,sans-serif;padding:12px 24px;display:inline-block}
</style></head><body>
<header><a href="/"><img src="/assets/acme-logo.png" alt="Acme logo" width="160" height="48"></a></header>
<main><h1>Hello</h1><img src="/assets/photo.jpg" alt="Team" width="400" height="300">
<a class="elementor-button" href="/contact">Contact us</a></main>
<footer><img src="/assets/acme-logo.png" alt="Acme logo" width="80" height="24"></footer>
</body></html>`;

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!chromium)("brand probe in the browser", () => {
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith("/assets/")) {
        res.writeHead(200, { "content-type": "image/png" }).end(PNG);
      } else {
        res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("reads css variables, the header logo, button colors and non-system fonts", async () => {
    const { createBrowserFetcher } = await import("../src/crawl/browser");
    const fetcher = await createBrowserFetcher({
      userAgent: "ForgecyTest",
      rootUrl: origin,
      allowPrivate: true,
      ...(chromium ? { executablePath: chromium } : {}),
    });
    try {
      const page = await fetcher.fetchPage(origin, {
        timeoutMs: 15000,
        screenshots: false,
        brandProbe: true,
      });
      const brand = page.brand;
      expect(brand).toBeDefined();
      expect(brand!.cssVars).toEqual(
        expect.arrayContaining([
          { name: "--brand-primary", hex: "#1d3a8a" },
          { name: "--brand-accent", hex: "#ffa500" },
          { name: "--e-global-color-primary", hex: "#6ec1e4" },
        ]),
      );
      expect(brand!.cssVars.map((v) => v.name)).not.toContain("--spacing");
      expect(brand!.themeColor).toBe("#1d3a8a");
      expect(brand!.buttonColors).toEqual(
        expect.arrayContaining([expect.objectContaining({ hex: "#69727d", role: "bg" })]),
      );
      expect(brand!.logos[0]?.url.endsWith("/assets/acme-logo.png")).toBe(true);
      expect(brand!.logos[0]?.repeats).toBe(2);
      expect(brand!.images.map((i) => i.url)).toContain(`${origin}/assets/photo.jpg`);
      expect(brand!.fonts.map((f) => f.family)).not.toContain("Arial");
      expect(brand!.organization?.name).toBe("Acme");

      const without = await fetcher.fetchPage(origin, { timeoutMs: 15000, screenshots: false });
      expect(without.brand).toBeUndefined();
    } finally {
      await fetcher.close();
    }
  }, 60000);
});
