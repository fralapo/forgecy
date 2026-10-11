import { describe, expect, it } from "vitest";
import {
  addressForm,
  creditBeforeHashtags,
  denseRuns,
  findAiTells,
  findPlaceholder,
  hashtagSet,
} from "../src/carousels/copy-lint";

const kinds = (text: string, lang: string) => findAiTells(text, lang).map((t) => t.kind);

describe("findAiTells", () => {
  it.each([
    ["Il prezzo — onesto — conta", "it", "dash"],
    ["Non è solo un prodotto, è un metodo.", "it", "contrast"],
    ["È importante notare che serve tempo.", "it", "filler"],
    ["Siamo leader del settore.", "it", "pressRelease"],
    ["Abbiamo scelto un metodo, rendendo tutto più semplice.", "it", "gerund"],
    ["Il futuro è già qui.", "it", "closer"],
    ["It works — and fast", "en", "dash"],
    ["It's not just a tool, it's a habit.", "en", "contrast"],
    ["It is important to note that costs vary.", "en", "filler"],
    ["A cutting-edge platform", "en", "pressRelease"],
    ["We shipped it, making it faster.", "en", "gerund"],
    ["Exciting times ahead.", "en", "closer"],
  ])("finds %s (%s) as %s", (text, lang, kind) => {
    expect(kinds(text, lang)).toContain(kind);
  });

  it("leaves plain copy and hyphenated words alone", () => {
    expect(kinds("Compra il pane, poi vai a casa. Un tavolo ben-fatto.", "it")).toEqual([]);
    expect(kinds("Buy bread, then go home. A well-made table.", "en")).toEqual([]);
  });
  it("does not lint a language it has no patterns for", () => {
    expect(findAiTells("Es ist wichtig — sehr wichtig", "de")).toEqual([]);
  });
  it("reports the matched words", () => {
    expect(findAiTells("Al fine di capire", "it")[0]?.match).toBe("Al fine di");
  });
});

describe("findPlaceholder", () => {
  it.each([
    "Prezzo [da confermare]",
    "TODO titolo",
    "Lorem ipsum dolor",
    "Ciao {{nome}}",
    "Costa XXX euro",
    "TBD",
  ])("finds a marker in %s", (text) => expect(findPlaceholder(text)).not.toBeNull());
  it.each(["Un titolo vero", "Todo bien", "Il codice 3XX"])("passes %s", (text) =>
    expect(findPlaceholder(text)).toBeNull(),
  );
});

describe("hashtags and credits", () => {
  it("counts distinct tags across the list and the caption", () => {
    expect(hashtagSet(["#Uno", "due"], "Testo #uno #tre").size).toBe(3);
    expect(hashtagSet([], "nessuno").size).toBe(0);
  });
  it("wants the credit in the caption and before the first hashtag", () => {
    expect(creditBeforeHashtags("Testo\nFoto: Anna R.\n#a #b", "Foto: Anna R.")).toBe(true);
    expect(creditBeforeHashtags("Testo #a\nFoto: Anna R.", "Foto: Anna R.")).toBe(false);
    expect(creditBeforeHashtags("Testo", "Foto: Anna R.")).toBe(false);
    expect(creditBeforeHashtags("Testo, foto: anna r.", "Foto: Anna R.")).toBe(true);
  });
});

describe("addressForm", () => {
  it("tells tu from voi in Italian, and stays silent when mixed or absent", () => {
    expect(addressForm("Se vuoi, puoi provare", "it")).toBe("tu");
    expect(addressForm("Se volete, potete provare", "it")).toBe("voi");
    expect(addressForm("Tu e voi insieme", "it")).toBeNull();
    expect(addressForm("Il pane è buono", "it")).toBeNull();
    expect(addressForm("You can try", "en")).toBeNull();
  });
});

describe("denseRuns", () => {
  it("returns runs of four or more", () => {
    expect(denseRuns([true, true, true, false, true])).toEqual([]);
    expect(denseRuns([false, true, true, true, true, false])).toEqual([[1, 4]]);
    expect(denseRuns([true, true, true, true, true])).toEqual([[0, 4]]);
    expect(denseRuns([true, true, false, true, true, true, true])).toEqual([[3, 6]]);
  });
});
