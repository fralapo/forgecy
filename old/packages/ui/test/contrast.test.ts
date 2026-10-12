// Brand Guard contrast gate: blocks the merge when a token change breaks WCAG 2.2 AA.
import { describe, expect, it } from "vitest";
import tokensJson from "../tokens/forgecy.tokens.json";
import {
  checkContrast,
  evaluateBrandGuard,
  flattenTokens,
  formatRatio,
  relativeLuminance,
  tokenHex,
  type TokenTree,
} from "../src/tokens";

const tree = tokensJson as unknown as TokenTree;
const tokens = flattenTokens(tree);
const hex = (path: string) => tokenHex(tokens, path);

describe("checkContrast", () => {
  it("matches WCAG reference values", () => {
    expect(checkContrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(checkContrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(checkContrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(checkContrast("#245BFF", "#F6F4EF")).toBe(checkContrast("#F6F4EF", "#245BFF"));
  });

  it("formats ratios for display", () => {
    expect(formatRatio(5.234)).toBe("5.2:1");
  });
});

describe("spec pairs (section 03)", () => {
  const white = hex("color.white");
  const porcelain = hex("color.porcelain");
  const graphite = hex("color.graphite-900");

  it.each([
    ["Deep Graphite on white", "color.graphite-900", white, 4.5],
    ["white on Forge Blue", "color.forge-blue", white, 4.5],
    ["white on Forge Blue 700", "color.forge-blue-700", white, 4.5],
    ["Forge Blue 700 on porcelain", "color.forge-blue-700", porcelain, 4.5],
    ["Graphite 70 on porcelain", "color.graphite-70", porcelain, 4.5],
    ["Graphite 50 on white", "color.graphite-50", white, 3],
    ["Graphite 50 on porcelain", "color.graphite-50", porcelain, 3],
    ["Green 700 on porcelain", "color.green-700", porcelain, 4.5],
    ["Orange 700 on porcelain", "color.orange-700", porcelain, 4.5],
    ["Red 700 on porcelain", "color.red-700", porcelain, 4.5],
    ["Deep Graphite on Amber", "color.amber", graphite, 4.5],
  ] as const)("%s >= %d:1", (_name, fg, bg, min) => {
    expect(checkContrast(hex(fg), bg)).toBeGreaterThanOrEqual(min);
  });

  it.each([
    ["semantic.dark.text.primary"],
    ["semantic.dark.text.secondary"],
    ["semantic.dark.text.link"],
    ["semantic.dark.status.success.text"],
    ["semantic.dark.status.warning.text"],
    ["semantic.dark.status.error.text"],
    ["semantic.dark.accent.highlight"],
  ])("dark %s on #171821 >= 4.5:1", (path) => {
    expect(hex("semantic.dark.bg.app")).toBe("#171821");
    expect(checkContrast(hex(path), "#171821")).toBeGreaterThanOrEqual(4.5);
  });

  it("documents why some colors are restricted to fills", () => {
    expect(checkContrast(hex("color.amber"), white)).toBeLessThan(3);
    expect(checkContrast(hex("color.gray-grid"), white)).toBeLessThan(3);
    expect(checkContrast(hex("color.orange"), white)).toBeLessThan(4.5);
  });

  it.each([
    ["color.graphite-900", white, 17.7],
    ["color.graphite-70", white, 7.1],
    ["color.forge-blue", white, 5.2],
    ["color.forge-blue-700", white, 7.2],
    ["color.graphite-50", white, 3.8],
    ["color.green-700", white, 5.4],
    ["color.red-700", white, 5.6],
  ] as const)("%s on white matches the spec table (%d:1)", (fg, bg, expected) => {
    expect(checkContrast(hex(fg), bg)).toBeCloseTo(expected, 1);
  });
});

describe("Brand Guard semantic pairs", () => {
  const results = evaluateBrandGuard(tree);

  it("covers light and dark themes", () => {
    expect(results.some((r) => r.theme === "light")).toBe(true);
    expect(results.some((r) => r.theme === "dark")).toBe(true);
  });

  it.each(results.map((r) => [`${r.theme} · ${r.label}`, r] as const))("%s", (_name, r) => {
    expect(r.ratio, `${r.fgHex} on ${r.bgHex} = ${formatRatio(r.ratio)}`).toBeGreaterThanOrEqual(
      r.min,
    );
  });
});
