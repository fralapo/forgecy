import type { SiteProbe } from "@forgecy/audit";
import { describe, expect, it } from "vitest";
import type { CandidateProposal } from "../src/import/candidates";
import { gateCandidates } from "../src/import/gate";
import { parseSiteProbe } from "../src/import/probe-schema";
import { knownColors, knownFonts } from "../src/import/site-colors";
import { quoteInPage } from "../src/import/verify";

const probe = (over: Partial<SiteProbe> = {}): SiteProbe => ({
  cssVars: [],
  buttonColors: [],
  fonts: [],
  logos: [],
  images: [],
  ...over,
});

const PAGES = [
  {
    locator: "/",
    text: "DeoDue è bifase: una fase ammorbidisce, l’altra è solo profumo. Nata nel Sud Italia.",
  },
  { locator: "/about", text: "Siamo una famiglia che produce deodoranti dal 1998." },
];

const text = (quote: string, locator = "/"): CandidateProposal => ({
  path: "/document/strategy/positioning",
  op: "set",
  value: "Deodorante bifase",
  evidence: { locator, quote },
});
const color = (hex: string, name = "Azzurro"): CandidateProposal => ({
  kind: "color",
  path: "",
  op: "set",
  value: { name, hex, usage: "primary" },
  evidence: { locator: "/", quote: "x" },
});
const font = (family: string): CandidateProposal => ({
  path: "/document/visual/typography",
  op: "append",
  value: { role: "display", family, weights: [], licenseStatus: "to_verify" },
  evidence: { locator: "/" },
});
const tone = (goodExample: string): CandidateProposal => ({
  path: "/document/verbal/toneAxes",
  op: "append",
  value: { axis: "formal", value: 2, goodExample, badExample: "Ehi bro, compra!" },
  evidence: { locator: "/", quote: "una fase ammorbidisce, l’altra è solo profumo" },
});

describe("gateCandidates", () => {
  it("discards a color the site never declared (Azzurro #0000FF with no visual data)", () => {
    const r = gateCandidates({ candidates: [color("#0000FF")], pages: PAGES });
    expect(r.keep).toEqual([]);
    expect(r.discarded).toEqual([{ path: "color:#0000FF", reason: "hex_not_extracted" }]);
  });

  it("compares hex values after normalization, whatever the case or form", () => {
    const visual = probe({ cssVars: [{ name: "--brand", hex: "#1d3a8a" }] });
    const r = gateCandidates({
      candidates: [color("1D3A8A"), color("#1D3A8B")],
      pages: PAGES,
      visual,
    });
    expect(r.keep).toHaveLength(1);
    expect(r.discarded.map((d) => d.reason)).toEqual(["hex_not_extracted"]);
  });

  it("discards a quote that is not on the cited page", () => {
    const r = gateCandidates({
      candidates: [
        text("una fase ammorbidisce, l'altra è solo profumo"),
        text("una fase ammorbidisce, l'altra è solo profumo", "/about"),
        text("Il deodorante più venduto d'Italia"),
        text("Il deodorante più venduto d'Italia", "/missing"),
      ],
      pages: PAGES,
    });
    expect(r.keep).toHaveLength(1);
    expect(r.discarded.map((d) => d.reason)).toEqual(Array(3).fill("quote_not_in_page"));
  });

  it("drops a framework default color, keeps it only under a brand-named variable", () => {
    const wp = probe({ cssVars: [{ name: "--wp--preset--color--blue", hex: "#007bff" }] });
    const r = gateCandidates({ candidates: [color("#007BFF")], pages: PAGES, visual: wp });
    expect(r.discarded).toEqual([{ path: "color:#007BFF", reason: "framework_default" }]);

    const own = probe({ cssVars: [{ name: "--color-primary", hex: "#007bff" }] });
    expect(
      gateCandidates({ candidates: [color("#007BFF")], pages: PAGES, visual: own }).keep,
    ).toHaveLength(1);
  });

  it("requires 12 characters of quote and 6 in every ellipsis segment", () => {
    const r = gateCandidates({
      candidates: [
        text("è solo profumo"), // 14 chars: ok
        text("Nata nel Sud"), // exactly 12: ok
        text("Sud Italia"), // 10: too short although on the page
        text("DeoDue è bifase … Italia"), // "Italia" is 6: ok
        text("DeoDue è bifase … It"), // 2-char segment matches anything
      ],
      pages: PAGES,
    });
    expect(r.keep.map((c) => c.evidence.quote)).toEqual([
      "è solo profumo",
      "Nata nel Sud",
      "DeoDue è bifase … Italia",
    ]);
    expect(r.discarded).toHaveLength(2);
  });

  it("checks that the good example of a tone axis is a real quote", () => {
    const r = gateCandidates({
      candidates: [tone("una fase ammorbidisce"), tone("Dolcezza che avvolge ogni giorno")],
      pages: PAGES,
    });
    expect(r.keep).toHaveLength(1);
    expect(r.discarded).toEqual([
      { path: "/document/verbal/toneAxes", reason: "quote_not_in_page" },
    ]);
  });

  it("keeps only fonts the site uses, and generic ones only when loaded", () => {
    const visual = probe({
      fonts: [
        { family: "Playfair Display", roles: ["headings"], loaded: true },
        { family: "Arial", roles: ["body"], loaded: false },
        { family: "Helvetica", roles: ["button"], loaded: true },
      ],
    });
    const r = gateCandidates({
      candidates: [font("Playfair Display"), font("Arial"), font("Comic Sans"), font("helvetica")],
      pages: PAGES,
      visual,
    });
    expect(r.keep.map((c) => (c.value as { family: string }).family)).toEqual([
      "Playfair Display",
      "helvetica",
    ]);
    expect(r.discarded.map((d) => d.reason)).toEqual(["generic_font", "font_not_extracted"]);
    expect(
      gateCandidates({ candidates: [font("Inter")], pages: PAGES }).discarded.map((d) => d.reason),
    ).toEqual(["font_not_extracted"]);
  });
});

describe("quoteInPage minSegment", () => {
  it("is off by default, so existing callers keep their behavior", () => {
    expect(quoteInPage("bifase … It", PAGES[0]!.text)).toBe(true);
    expect(quoteInPage("bifase … It", PAGES[0]!.text, { minSegment: 6 })).toBe(false);
  });
});

describe("known colors and fonts", () => {
  const visual = probe({
    cssVars: [
      { name: "--wp--preset--color--grey", hex: "#abb8c3" },
      { name: "--color-text", hex: "#222222" },
      { name: "--brand-primary", hex: "#1d3a8a" },
      { name: "--accent", hex: "#1D3A8A" },
      { name: "--hot", hex: "#007bff" },
    ],
    themeColor: "#f5ebdc",
    buttonColors: [
      { hex: "#c0392b", role: "bg", weight: 10 },
      { hex: "#ffffff", role: "text", weight: 500 },
      { hex: "#f5ebdc", role: "bg", weight: 900 },
    ],
    fonts: [
      { family: "Playfair Display", roles: ["headings"], loaded: true },
      { family: "Arial", roles: ["body"], loaded: false },
    ],
  });

  it("orders CSS variables first (named from the variable), then theme-color, then buttons by weight", () => {
    const known = knownColors(visual);
    expect(known.map((c) => [c.hex, c.name])).toEqual([
      ["#1d3a8a", "primary"],
      ["#222222", "text"],
      ["#f5ebdc", "theme color"],
      ["#ffffff", "button text"],
      ["#c0392b", "button background"],
    ]);
  });

  it("leaves out generic system fonts the page did not load", () => {
    expect(knownFonts(visual).map((f) => f.family)).toEqual(["Playfair Display"]);
  });
});

describe("parseSiteProbe", () => {
  const valid = probe({
    cssVars: [{ name: "--brand", hex: "#112233" }],
    themeColor: "#aabbcc",
    fonts: [{ family: "Inter", roles: ["body"], loaded: true }],
    organization: { name: "DeoDue", sameAs: [] },
  });

  it("is tolerant: optional parts missing, unknown keys ignored", () => {
    expect(parseSiteProbe(valid)).toEqual(valid);
    expect(parseSiteProbe({ ...probe(), extra: true })).toEqual(probe());
  });

  it("treats an absent, malformed or oversized value as absent", () => {
    expect(parseSiteProbe(null)).toBeUndefined();
    expect(parseSiteProbe({})).toBeUndefined();
    expect(parseSiteProbe({ ...valid, cssVars: [{ name: "--a", hex: "blue" }] })).toBeUndefined();
    expect(parseSiteProbe({ ...valid, themeColor: "#fff" })).toBeUndefined();
    expect(
      parseSiteProbe({ ...valid, fonts: [{ family: "Inter", roles: ["body"] }] }),
    ).toBeUndefined();
    expect(
      parseSiteProbe({
        ...valid,
        cssVars: Array.from({ length: 41 }, (_, i) => ({ name: `--v${i}`, hex: "#000000" })),
      }),
    ).toBeUndefined();
  });
});
