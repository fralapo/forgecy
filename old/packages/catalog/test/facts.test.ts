import { productFactStatuses, usableFactStatuses } from "@forgecy/core";
import { describe, expect, it } from "vitest";
import { factInputSchema, splitKeywords } from "../src/products/facts";

describe("product facts", () => {
  it("defaults a fact to catalog_only with no source", () => {
    expect(factInputSchema.parse({ text: " Senza glutine " })).toEqual({
      text: "Senza glutine",
      keywords: [],
      status: "catalog_only",
      source: "",
    });
  });
  it("accepts every status and rejects an unknown one or an empty text", () => {
    for (const status of productFactStatuses)
      expect(factInputSchema.safeParse({ text: "x", status }).success).toBe(true);
    expect(factInputSchema.safeParse({ text: "x", status: "maybe" }).success).toBe(false);
    expect(factInputSchema.safeParse({ text: "  " }).success).toBe(false);
  });
  it("only printed_on_pack and catalog_only are usable in public copy", () => {
    expect([...usableFactStatuses]).toEqual(["printed_on_pack", "catalog_only"]);
  });
  it("splits typed keywords on commas, semicolons and lines, without duplicates", () => {
    expect(splitKeywords("bio, vegan ;bio\n  zero  ,")).toEqual(["bio", "vegan", "zero"]);
    expect(splitKeywords("")).toEqual([]);
  });
});
