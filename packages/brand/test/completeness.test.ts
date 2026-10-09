import { describe, expect, it } from "vitest";
import { brandCompleteness } from "../src/completeness";
import { emptyDocument, parseDocument } from "../src/document";
import { defaultTokens, hexToDtcg, type TokenTree } from "../src/tokens";

const sourced = <T>(value: T, over: Record<string, unknown> = {}) => ({
  id: "i1",
  value,
  sourceIds: ["s1"],
  confidence: "medium",
  ...over,
});

function withColors(hexes: string[]): TokenTree {
  const tokens = defaultTokens() as { color: { reference: Record<string, unknown> } };
  hexes.forEach((hex, i) => {
    tokens.color.reference[`brand-${i}`] = { $value: hexToDtcg(hex) };
  });
  return tokens;
}

const keysFilled = (r: ReturnType<typeof brandCompleteness>) =>
  r.sections.filter((s) => s.filled).map((s) => s.key);

describe("brandCompleteness", () => {
  it("an empty identity is 0 of 9, even with the starting palette", () => {
    const r = brandCompleteness(emptyDocument(), defaultTokens(), 0);
    expect(r).toMatchObject({ filled: 0, total: 9, percent: 0 });
    expect(r.sections.map((s) => s.key)).toEqual([
      "about",
      "tagline",
      "audience",
      "tone",
      "aesthetics",
      "fonts",
      "palette",
      "logo",
      "images",
    ]);
  });

  it("one-liner, audience, three colors and a font fill their sections", () => {
    const doc = parseDocument({
      strategy: {
        oneLiner: sourced("Il deodorante bifase"),
        audience: [sourced({ name: "Famiglie" })],
      },
      visual: { typography: [sourced({ role: "display", family: "Playfair Display" })] },
    });
    const r = brandCompleteness(doc, withColors(["#1D3A8A", "#F5EBDC", "#AA3322"]), 0);
    expect(keysFilled(r)).toEqual(["about", "tagline", "audience", "fonts", "palette"]);
    expect(r.percent).toBe(56);
  });

  it("the starting colors do not count, two of the brand's own are not enough", () => {
    const r = brandCompleteness(emptyDocument(), withColors(["#1D3A8A", "#F5EBDC"]), 0);
    expect(keysFilled(r)).toEqual([]);
  });

  it("a starting color a source touched counts", () => {
    const tokens = defaultTokens() as { color: { reference: Record<string, unknown> } };
    tokens.color.reference.white = {
      $value: hexToDtcg("#FFFFFF"),
      $extensions: { forgecy: { sourceIds: ["s1"], confidence: "high" } },
    };
    tokens.color.reference.a = { $value: hexToDtcg("#111111") };
    tokens.color.reference.b = { $value: hexToDtcg("#222222") };
    expect(keysFilled(brandCompleteness(emptyDocument(), tokens, 0))).toEqual(["palette"]);
  });

  it("8 of 9 sections is 89 percent", () => {
    const doc = parseDocument({
      strategy: {
        oneLiner: sourced("Il deodorante bifase"),
        audience: [sourced({ name: "Famiglie" })],
      },
      verbal: {
        toneAxes: [
          sourced({ axis: "formal", value: 2, goodExample: "Ciao", badExample: "Egregio" }),
        ],
      },
      visual: {
        imagery: sourced({ subjects: ["flaconi"] }),
        typography: [sourced({ role: "display", family: "Playfair Display" })],
        logo: { variants: [{ id: "l1", role: "logo_primary", sourceId: "s2" }] },
      },
    });
    const r = brandCompleteness(doc, withColors(["#1D3A8A", "#F5EBDC", "#AA3322"]), 2);
    expect(r).toMatchObject({ filled: 8, percent: 89 });
    expect(r.sections.find((s) => !s.filled)?.key).toBe("images");
    expect(brandCompleteness(doc, withColors(["#1D3A8A", "#F5EBDC", "#AA3322"]), 3).percent).toBe(
      100,
    );
  });

  it("the positioning alone fills About, a visual do fills Aesthetics, deprecated audience does not count", () => {
    const doc = parseDocument({
      strategy: {
        positioning: sourced("Deodoranti del Sud"),
        audience: [sourced({ name: "Vecchi" }, { deprecated: true })],
      },
      visual: { do: ["Foto luminose"] },
    });
    expect(keysFilled(brandCompleteness(doc, defaultTokens(), 0))).toEqual(["about", "aesthetics"]);
  });
});
