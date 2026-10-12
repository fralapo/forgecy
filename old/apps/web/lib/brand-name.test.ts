import { describe, expect, it } from "vitest";
import { nameFromUrl, uniqueSlug } from "./brand-name";

describe("nameFromUrl", () => {
  it("takes the first label of the host without www, capitalized", () => {
    expect(nameFromUrl("https://www.deodue.it/shop?x=1")).toBe("Deodue");
    expect(nameFromUrl("http://caffe-rossi.com")).toBe("Caffe rossi");
    expect(nameFromUrl("https://WWW.Acme.co.uk")).toBe("Acme");
  });

  it("falls back when there is no host", () => {
    expect(nameFromUrl("not a url")).toBe("Brand");
  });
});

describe("uniqueSlug", () => {
  it("numbers a slug that is taken", async () => {
    const used = new Set(["acme", "acme-2"]);
    expect(await uniqueSlug("acme", async (s) => used.has(s))).toBe("acme-3");
    expect(await uniqueSlug("other", async (s) => used.has(s))).toBe("other");
  });
});
