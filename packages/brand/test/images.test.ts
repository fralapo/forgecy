import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { gateCandidates } from "../src/import/gate";
import { logoCandidate, visualCandidates } from "../src/import/candidates";
import {
  classifyImageHeuristic,
  describeImage,
  MAX_INPUT_PIXELS,
  siteDomain,
  svgIsSafe,
  svgSize,
  type ImageFacts,
} from "../src/import/images";

const facts = (over: Partial<ImageFacts> = {}): ImageFacts => ({
  w: 800,
  h: 600,
  alt: "",
  url: "https://x.test/a.jpg",
  mime: "image/jpeg",
  whiteBorderRatio: 0,
  paletteSize: 60,
  ...over,
});

describe("classifyImageHeuristic", () => {
  it("near-white borders mean a product shot", () => {
    expect(classifyImageHeuristic(facts({ whiteBorderRatio: 0.9, w: 600, h: 600 }))).toBe(
      "product",
    );
  });
  it("a wide, colorful photo is a scene", () => {
    expect(classifyImageHeuristic(facts({ w: 1600, h: 900, paletteSize: 80 }))).toBe("scene");
  });
  it("a tall or square colorful photo is a subject on its own", () => {
    expect(classifyImageHeuristic(facts({ w: 600, h: 900, paletteSize: 80 }))).toBe("product");
  });
  it("few colors and svg are graphics", () => {
    expect(classifyImageHeuristic(facts({ paletteSize: 6 }))).toBe("graphic");
    expect(classifyImageHeuristic(facts({ mime: "image/svg+xml", paletteSize: 0 }))).toBe(
      "graphic",
    );
    expect(classifyImageHeuristic(facts({ paletteSize: 15 }))).toBe("graphic");
  });
  it("logo in the url or the alt is a logo in the header or declared on the site's own domain", () => {
    const site = "https://www.deodue.test/";
    expect(
      classifyImageHeuristic(facts({ url: "https://x.test/img/Logo-dark.png", inHeader: true })),
    ).toBe("logo");
    expect(
      classifyImageHeuristic(facts({ alt: "Our logo", whiteBorderRatio: 1, inHeader: true })),
    ).toBe("logo");
    for (const source of ["jsonld", "og", "icon"] as const)
      expect(
        classifyImageHeuristic(
          facts({ url: "https://cdn.deodue.test/logo.png", source, siteUrl: site }),
        ),
      ).toBe("logo");
  });

  it("a logo elsewhere (a parent company's in the page body, another domain) is a graphic", () => {
    const site = "https://www.deodue.test/";
    // deodue: the parent company's logo among the content images.
    expect(
      classifyImageHeuristic(
        facts({ url: "https://www.deodue.test/up/logochimicleanspa@300x.png", siteUrl: site }),
      ),
    ).toBe("graphic");
    expect(
      classifyImageHeuristic(
        facts({ url: "https://partner.test/logo.png", source: "jsonld", siteUrl: site }),
      ),
    ).toBe("graphic");
  });

  it("compares registrable domains", () => {
    expect(siteDomain("https://cdn.deodue.test/a.png")).toBe("deodue.test");
    expect(siteDomain("https://shop.rossi.co.uk/")).toBe("rossi.co.uk");
    expect(siteDomain("not a url")).toBeNull();
  });
});

const flat = (w: number, h: number, color: string) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .png()
    .toBuffer();

describe("describeImage", () => {
  it("reads the real size of a flat white image", async () => {
    const d = await describeImage(await flat(320, 240, "#ffffff"));
    expect(d).toMatchObject({ w: 320, h: 240, whiteBorderRatio: 1 });
    expect(d.paletteSize).toBe(1);
  });

  it("a subject on white has white borders and a small palette", async () => {
    const subject = await sharp({
      create: { width: 120, height: 120, channels: 3, background: "#cc2200" },
    })
      .png()
      .toBuffer();
    const img = await sharp({
      create: { width: 400, height: 400, channels: 3, background: "#ffffff" },
    })
      .composite([{ input: subject, top: 140, left: 140 }])
      .png()
      .toBuffer();
    const d = await describeImage(img);
    expect(d.whiteBorderRatio).toBeGreaterThan(0.95);
    expect(d.paletteSize).toBeLessThanOrEqual(8);
  });

  it("noise has no white border and a large palette", async () => {
    const noise = await sharp(randomBytes(300 * 200 * 3), {
      raw: { width: 300, height: 200, channels: 3 },
    })
      .png()
      .toBuffer();
    const d = await describeImage(noise);
    expect(d).toMatchObject({ w: 300, h: 200 });
    expect(d.whiteBorderRatio).toBeLessThan(0.1);
    expect(d.paletteSize).toBeGreaterThan(24);
  });

  it("treats transparency as white", async () => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    expect((await describeImage(png)).whiteBorderRatio).toBe(1);
  });

  it("refuses an image that decodes to more pixels than the limit", async () => {
    const bomb = await sharp({
      create: { width: 7200, height: 7200, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(7200 * 7200).toBeGreaterThan(MAX_INPUT_PIXELS);
    await expect(describeImage(bomb)).rejects.toThrow(/pixel/i);
  });

  it("throws on bytes that are not an image", async () => {
    await expect(describeImage(new TextEncoder().encode("<html></html>"))).rejects.toThrow();
  });
});

describe("svg checks", () => {
  const svg = (inner: string, attrs = 'viewBox="0 0 120 40"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

  it("accepts plain shapes", () => {
    expect(svgIsSafe(svg('<path d="M0 0h10v10z" fill="#123456"/>'))).toBe(true);
  });
  it.each([
    ["script", svg("<script>alert(1)</script>")],
    ["event handler", svg('<rect onload="x()" width="1" height="1"/>')],
    ["javascript url", svg('<a href="javascript:alert(1)"><rect/></a>')],
    ["foreignObject", svg("<foreignObject><div>hi</div></foreignObject>")],
    ["external href", svg('<image href="https://evil.test/a.png"/>')],
    ["external xlink", svg('<use xlink:href="//evil.test/a.svg#x"/>')],
    ["css url", svg('<rect style="fill:url(http://evil.test/x)"/>')],
  ])("refuses %s", (_name, text) => {
    expect(svgIsSafe(text)).toBe(false);
  });

  it("reads the size from viewBox, else width and height", () => {
    expect(svgSize(svg(""))).toEqual({ w: 120, h: 40 });
    expect(svgSize(svg("", 'width="64px" height="32"'))).toEqual({ w: 64, h: 32 });
    expect(svgSize(svg("", ""))).toEqual({ w: 0, h: 0 });
  });
});

describe("logo candidate", () => {
  const probe = {
    cssVars: [],
    buttonColors: [],
    fonts: [],
    logos: [],
    images: [],
  };
  const logo = { url: "https://x.test/logo.svg" };

  it("is a primary-logo variant pointing to the stored source", () => {
    expect(logoCandidate("src-1", logo)).toMatchObject({
      kind: "logo",
      path: "/document/visual/logo/variants",
      op: "append",
      value: { role: "logo_primary", sourceId: "src-1", background: "any" },
      evidence: { locator: logo.url },
    });
  });

  it("joins the site candidates only when a logo was stored, and passes the gate", () => {
    expect(visualCandidates(probe).some((c) => c.kind === "logo")).toBe(false);
    const all = visualCandidates(probe, { sourceId: "src-1", image: logo });
    const gated = gateCandidates({ candidates: all, pages: [], visual: probe });
    expect(gated.keep.map((c) => c.kind)).toEqual(["logo"]);
    expect(gated.discarded).toEqual([]);
  });
});
