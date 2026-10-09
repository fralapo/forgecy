import type { ProbeImage, SiteProbe } from "@forgecy/audit";
import { describe, expect, it } from "vitest";
import { mergeProbes } from "../src/probe-merge";

const image = (url: string, over: Partial<ProbeImage> = {}): ProbeImage => ({
  url,
  alt: "",
  w: 100,
  h: 100,
  inHeader: false,
  inFooter: false,
  repeats: 1,
  source: "img",
  ...over,
});
const probe = (over: Partial<SiteProbe> = {}): SiteProbe => ({
  cssVars: [],
  buttonColors: [],
  fonts: [],
  logos: [],
  images: [],
  ...over,
});

describe("mergeProbes", () => {
  it("counts the pages a logo is on, whatever its in-page repeats", () => {
    const logo = image("https://x.it/logo.svg", { alt: "Logo", inHeader: true, repeats: 4 });
    const merged = mergeProbes([
      probe({ logos: [logo] }),
      probe({ logos: [{ ...logo, repeats: 1 }] }),
      probe({ logos: [logo, logo] }),
      probe(),
    ]);
    expect(merged.logos).toHaveLength(1);
    expect(merged.logos[0]).toMatchObject({ url: "https://x.it/logo.svg", repeats: 3 });
  });

  it("dedupes images by url, keeps the largest size and the header/footer flags", () => {
    const merged = mergeProbes([
      probe({ images: [image("https://x.it/a.jpg", { w: 10, h: 10, inFooter: true })] }),
      probe({
        images: [image("https://x.it/a.jpg", { w: 400, h: 300 }), image("https://x.it/b.jpg")],
      }),
    ]);
    expect(merged.images.map((i) => i.url)).toEqual(["https://x.it/a.jpg", "https://x.it/b.jpg"]);
    expect(merged.images[0]).toMatchObject({ w: 400, h: 300, inFooter: true, repeats: 2 });
    expect(merged.images[1]!.repeats).toBe(1);
  });

  it("dedupes css vars by hex keeping the first name, and takes the first theme color", () => {
    const merged = mergeProbes([
      probe({ cssVars: [{ name: "--brand", hex: "#112233" }] }),
      probe({
        cssVars: [
          { name: "--primary", hex: "#112233" },
          { name: "--accent", hex: "#ff0000" },
        ],
        themeColor: "#ff0000",
      }),
      probe({ themeColor: "#00ff00" }),
    ]);
    expect(merged.cssVars).toEqual([
      { name: "--brand", hex: "#112233" },
      { name: "--accent", hex: "#ff0000" },
    ]);
    expect(merged.themeColor).toBe("#ff0000");
  });

  it("unions fonts (roles merged, loaded if any page loaded it) and sums button colors", () => {
    const merged = mergeProbes([
      probe({
        fonts: [{ family: "Inter", roles: ["body"], loaded: false }],
        buttonColors: [{ hex: "#111111", role: "bg", weight: 5 }],
      }),
      probe({
        fonts: [{ family: "inter", roles: ["headings"], loaded: true }],
        buttonColors: [
          { hex: "#111111", role: "bg", weight: 7 },
          { hex: "#111111", role: "text", weight: 20 },
        ],
      }),
    ]);
    expect(merged.fonts).toEqual([{ family: "Inter", roles: ["body", "headings"], loaded: true }]);
    expect(merged.buttonColors).toEqual([
      { hex: "#111111", role: "text", weight: 20 },
      { hex: "#111111", role: "bg", weight: 12 },
    ]);
  });

  it("the first organization wins", () => {
    const merged = mergeProbes([
      probe(),
      probe({ organization: { name: "Rossi", sameAs: [] } }),
      probe({ organization: { name: "Other", sameAs: [] } }),
    ]);
    expect(merged.organization?.name).toBe("Rossi");
  });

  it("caps every list and re-ranks logos best first", () => {
    const many = <T>(n: number, make: (i: number) => T) =>
      Array.from({ length: n }, (_, i) => make(i));
    const merged = mergeProbes([
      probe({
        cssVars: many(60, (i) => ({ name: `--c${i}`, hex: `#${i.toString(16).padStart(6, "0")}` })),
        buttonColors: many(40, (i) => ({
          hex: `#${i.toString(16).padStart(6, "0")}`,
          role: "bg" as const,
          weight: i,
        })),
        fonts: many(20, (i) => ({ family: `F${i}`, roles: ["body" as const], loaded: true })),
        images: many(100, (i) => image(`https://x.it/${i}.jpg`)),
        logos: [
          image("https://x.it/footer-logo.svg", { inFooter: true }),
          ...many(12, (i) => image(`https://x.it/logo${i}.svg`, { inHeader: true })),
        ],
      }),
    ]);
    expect(merged.cssVars).toHaveLength(40);
    expect(merged.buttonColors).toHaveLength(24);
    expect(merged.buttonColors[0]!.weight).toBe(39);
    expect(merged.fonts).toHaveLength(12);
    expect(merged.images).toHaveLength(60);
    expect(merged.logos).toHaveLength(8);
    expect(merged.logos.every((l) => l.inHeader)).toBe(true);
  });

  it("an empty crawl gives an empty probe", () => {
    expect(mergeProbes([])).toEqual(probe());
  });
});
