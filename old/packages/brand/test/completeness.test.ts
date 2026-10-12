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

const AXES = ["formal", "technical", "serious", "institutional", "conservative"];
const allAxes = () =>
  AXES.map((axis, i) =>
    sourced({ axis, value: 2, goodExample: "Ciao", badExample: "Egregio" }, { id: `t${i}` }),
  );
const weAre = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    sourced({ weAre: `Diretti ${i}`, weAreNot: `Freddi ${i}` }, { id: `w${i}` }),
  );

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
      verbal: { toneAxes: allAxes(), weAreWeAreNot: weAre(4) },
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

  it("a one-liner over 20 words fills neither About nor Tagline, as the publish check says", () => {
    const long = Array.from({ length: 21 }, (_, i) => `parola${i}`).join(" ");
    const doc = parseDocument({ strategy: { oneLiner: sourced(long) } });
    expect(keysFilled(brandCompleteness(doc, defaultTokens(), 0))).toEqual([]);
    // The positioning does not hide a one-liner that is too long.
    const both = parseDocument({
      strategy: { oneLiner: sourced(long), positioning: sourced("Deodoranti del Sud") },
    });
    expect(keysFilled(brandCompleteness(both, defaultTokens(), 0))).toEqual([]);
  });

  it("Tone needs every tone axis and four we-are rows", () => {
    const some = parseDocument({
      verbal: { toneAxes: allAxes().slice(0, 3), weAreWeAreNot: weAre(4) },
    });
    expect(keysFilled(brandCompleteness(some, defaultTokens(), 0))).toEqual([]);
    const fewRows = parseDocument({ verbal: { toneAxes: allAxes(), weAreWeAreNot: weAre(1) } });
    expect(keysFilled(brandCompleteness(fewRows, defaultTokens(), 0))).toEqual([]);
    const full = parseDocument({ verbal: { toneAxes: allAxes(), weAreWeAreNot: weAre(4) } });
    expect(keysFilled(brandCompleteness(full, defaultTokens(), 0))).toEqual(["tone"]);
  });

  it("a logo variant that is not the primary logo does not fill Logo; an unverified font license does not empty Fonts", () => {
    const doc = parseDocument({
      visual: {
        logo: { variants: [{ id: "l1", role: "symbol", sourceId: "s2" }] },
        typography: [
          sourced({ role: "display", family: "Montserrat", licenseStatus: "to_verify" }),
        ],
      },
    });
    expect(keysFilled(brandCompleteness(doc, defaultTokens(), 0))).toEqual(["fonts"]);
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
