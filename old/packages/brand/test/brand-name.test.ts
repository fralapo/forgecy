import { describe, expect, it } from "vitest";
import { nameFromUrl, siteBrandName } from "../src/brand-name";

describe("nameFromUrl", () => {
  it("is the guess the brand page makes from a staging address", () => {
    expect(nameFromUrl("https://www.staging-g.deodue.it")).toBe("Staging g");
  });
});

describe("siteBrandName", () => {
  const titles = ["Home - DeoDue", "Prodotti - DeoDue", "Chi siamo – DeoDue"];

  it("prefers the JSON-LD organization, then og:site_name", () => {
    expect(siteBrandName({ organizationName: " DeoDue  Srl ", siteName: "Deo", titles })).toBe(
      "DeoDue Srl",
    );
    expect(siteBrandName({ siteName: "DeoDue", titles })).toBe("DeoDue");
    expect(siteBrandName({ organizationName: " ", siteName: "DeoDue", titles })).toBe("DeoDue");
  });

  it("a declared name that is the site's domain wins over the company behind it (deodue.it)", () => {
    const deodue = {
      organizationName: "ChimiClean S.p.A.",
      siteName: "DeoDue - ChimiClean S.p.A.",
      titles: ["DeoDue - ChimiClean S.p.A. - Detersivi e profumatori per la casa"],
      url: "https://www.staging-g.deodue.it",
    };
    expect(siteBrandName(deodue)).toBe("DeoDue");
    // Nothing matches the domain: the declared organization, as before.
    expect(siteBrandName({ ...deodue, url: "https://shop.example.com" })).toBe("ChimiClean S.p.A.");
  });

  it("else takes the title part that repeats across pages", () => {
    expect(siteBrandName({ titles })).toBe("DeoDue");
    expect(siteBrandName({ titles: ["Acme | Shop online", "Contatti | Acme"] })).toBe("Acme");
  });

  it("with one title, the shortest part beside a separator; never a generic page name", () => {
    expect(siteBrandName({ titles: ["DeoDue | Deodoranti bifase naturali"] })).toBe("DeoDue");
    expect(siteBrandName({ titles: ["Home - X"] })).toBeNull();
  });

  it("is null when nothing names the site", () => {
    expect(siteBrandName({ titles: [] })).toBeNull();
    // A lone title without a separator is a page, not a brand.
    expect(siteBrandName({ titles: ["Benvenuti nel nostro negozio"] })).toBeNull();
  });

  it("drops control characters and caps the length", () => {
    expect(siteBrandName({ siteName: "Deo\u0000Due​", titles: [] })).toBe("Deo Due");
    expect(siteBrandName({ siteName: "x".repeat(300), titles: [] })).toHaveLength(120);
  });
});
