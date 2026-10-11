import { describe, expect, it } from "vitest";
import { issuesFromMeasures, type SlotMeasure } from "../src/export/capture";
import { bindFunctionWords } from "../src/typography/bind";
import { typographyProblems } from "../src/typography/lines";

const NB = "\u00A0";

describe("bindFunctionWords", () => {
  it("glues Italian function words to the next word", () => {
    expect(bindFunctionWords("Il gatto di casa e la luna", "it")).toBe(
      `Il${NB}gatto di${NB}casa e${NB}la${NB}luna`,
    );
  });
  it("glues English function words and leaves other words alone", () => {
    expect(bindFunctionWords("The end of a story", "en")).toBe(`The${NB}end of${NB}a${NB}story`);
  });
  it("does not touch words that merely contain one, apostrophes or line breaks", () => {
    expect(bindFunctionWords("dell’arte media\nLa fine", "it")).toBe(
      `dell’arte media\nLa${NB}fine`,
    );
    expect(bindFunctionWords("Italia in", "it")).toBe("Italia in");
  });
  it("is locale-keyed: an English word is free in Italian", () => {
    expect(bindFunctionWords("the end", "it")).toBe("the end");
  });
});

describe("typographyProblems", () => {
  const kinds = (m: Parameters<typeof typographyProblems>[0], l: "it" | "en" = "it") =>
    typographyProblems(m, l).map((p) => p.kind);

  it("flags a widow: last line is one short word", () => {
    expect(kinds({ lines: 3, lineTexts: ["Un titolo molto", "lungo che va", "su"] })).toContain(
      "widow",
    );
    expect(kinds({ lines: 2, lineTexts: ["Un titolo molto lungo", "finisce bene qui"] })).toEqual(
      [],
    );
    expect(kinds({ lines: 1, lineTexts: ["ok"] })).toEqual([]);
  });
  it("does not call a long single word a widow", () => {
    expect(kinds({ lines: 2, lineTexts: ["Una parola molto", "straordinariamente"] })).toEqual([]);
  });
  it("flags a line ending on a function word, per locale", () => {
    const m = { lines: 2, lineTexts: ["Il gatto di", "casa mia qui"] };
    expect(typographyProblems(m, "it")).toEqual([{ kind: "bad_line_end", line: 1, word: "di" }]);
    expect(kinds({ lines: 2, lineTexts: ["The cat of", "my home today"] }, "en")).toEqual([
      "bad_line_end",
    ]);
    expect(kinds({ lines: 2, lineTexts: ["Cat of", "home today"] }, "it")).toEqual([]);
  });
  it("ignores a function word followed by punctuation and sees through non-breaking spaces", () => {
    expect(kinds({ lines: 2, lineTexts: ["Dove? In,", "casa mia"] })).toEqual([]);
    expect(kinds({ lines: 2, lineTexts: [`Il${NB}gatto${NB}di`, "casa mia"] })).toEqual([
      "bad_line_end",
    ]);
  });
  it("flags fonts under 26px and blocks over 7 lines", () => {
    expect(kinds({ lines: 2, fontSize: 25 })).toEqual(["small_font"]);
    expect(kinds({ lines: 2, fontSize: 26 })).toEqual([]);
    expect(kinds({ lines: 8 })).toEqual(["dense_block"]);
    expect(kinds({ lines: 7 })).toEqual([]);
  });
});

describe("typography in render issues", () => {
  const slot: SlotMeasure = {
    name: "body",
    kind: "text",
    overflow: false,
    outsideSlide: false,
    outsideSafe: false,
    lines: 2,
    lineTexts: ["The cat of", "dog"],
    fontSize: 24,
    naturalWidth: 0,
    naturalHeight: 0,
    rect: { x: 0, y: 0, width: 100, height: 40 },
  };
  it("adds typography issues only when the language is given, with translated text", () => {
    expect(issuesFromMeasures(0, [slot])).toEqual([]);
    const issues = issuesFromMeasures(0, [slot], {}, "en");
    expect(issues.map((i) => i.kind).sort()).toEqual(["bad_line_end", "small_font", "widow"]);
    expect(issues.find((i) => i.kind === "small_font")?.message).toBe(
      "“body” is set at 24 px, below the 26 px minimum.",
    );
  });
});
