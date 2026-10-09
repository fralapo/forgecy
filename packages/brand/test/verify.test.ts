import { describe, expect, it } from "vitest";
import {
  isFrameworkDefaultHex,
  isGenericFont,
  normalizeText,
  quoteInPage,
} from "../src/import/verify";

describe("quoteInPage", () => {
  const page =
    "DeoDue è bifase: una fase ammorbidisce, l’altra è solo profumo.\n  Nata nel Sud   Italia";
  it("matches despite curly quotes, case and whitespace", () => {
    expect(
      quoteInPage("DeoDue è bifase: una fase ammorbidisce, l'altra è solo profumo.", page),
    ).toBe(true);
    expect(quoteInPage("nata nel sud italia", page)).toBe(true);
  });
  it("accepts an ellipsis only when every segment is in the page", () => {
    expect(quoteInPage("DeoDue è bifase … solo profumo", page)).toBe(true);
    expect(quoteInPage("DeoDue è bifase … costa poco", page)).toBe(false);
  });
  it("rejects a paraphrase and an empty quote", () => {
    expect(quoteInPage("DeoDue ammorbidisce e profuma", page)).toBe(false);
    expect(quoteInPage("   ", page)).toBe(false);
  });
});

describe("palette and font filters", () => {
  it("flags Bootstrap, Elementor and Gutenberg defaults", () => {
    for (const h of ["#007bff", "#E83E8C", "#0d6efd", "#6ec1e4", "#cf2e2e"])
      expect(isFrameworkDefaultHex(h)).toBe(true);
    expect(isFrameworkDefaultHex("#1d3a8a")).toBe(false);
  });
  it("flags generic and system fonts only", () => {
    for (const f of ["Helvetica", "arial", "Verdana", "sans-serif", "system-ui", "Segoe UI"])
      expect(isGenericFont(f)).toBe(true);
    expect(isGenericFont("Roboto Slab")).toBe(false);
  });
  it("normalizeText is idempotent", () => {
    expect(normalizeText(normalizeText("  L’Aria  "))).toBe(normalizeText("  L’Aria  "));
  });
});
