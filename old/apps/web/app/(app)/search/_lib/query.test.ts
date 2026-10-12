import { describe, expect, it } from "vitest";
import { highlight, likePattern, parseSearchParams, searchHref } from "./query";

describe("parseSearchParams", () => {
  it("reads comma lists and repeated types, dropping unknown ones", () => {
    expect(parseSearchParams({ q: " rossi ", type: "carousel,nope,product" })).toEqual({
      q: "rossi",
      types: ["carousel", "product"],
      client: null,
      archived: false,
    });
    expect(
      parseSearchParams({ type: ["asset", "client"], client: "rossi", archived: "1" }),
    ).toEqual({ q: "", types: ["client", "asset"], client: "rossi", archived: true });
  });

  it("round-trips through searchHref", () => {
    const href = searchHref({ q: "fattura", types: ["carousel"], client: "rossi" });
    expect(href).toBe("/search?q=fattura&type=carousel&client=rossi");
    const sp = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseSearchParams(sp).types).toEqual(["carousel"]);
  });
});

describe("likePattern", () => {
  it("takes wildcards literally", () => {
    expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("highlight", () => {
  it("marks every case-insensitive match", () => {
    expect(highlight("Rossi e ROSSI", "rossi")).toEqual([
      { text: "Rossi", match: true },
      { text: " e ", match: false },
      { text: "ROSSI", match: true },
    ]);
    expect(highlight("Verdi", "xy")).toEqual([{ text: "Verdi", match: false }]);
  });
});
