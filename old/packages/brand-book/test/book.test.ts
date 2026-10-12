import { defaultTokens, emptyDocument, type BrandIdentityDocument } from "@forgecy/brand";
import { buildCarouselSchema, type TemplateManifest } from "@forgecy/carousel";
import { packageFromFiles, readTemplateDir } from "@forgecy/carousel/node";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { bookSlides, emptyBookSections, fitText, type BookInput } from "../src/book";
import { bookSections } from "../src/parts";

const TEMPLATE = path.resolve(import.meta.dirname, "../../../templates/reports/brand-book-a4");

const sourced = <T>(id: string, value: T) => ({
  id,
  value,
  sourceIds: ["s1"],
  confidence: "high" as const,
});

function fullDocument(): BrandIdentityDocument {
  const d = emptyDocument();
  d.strategy.oneLiner = sourced("o1", "Good coffee for people who work");
  d.strategy.positioning = sourced("p1", "The café for remote workers in the old town");
  d.strategy.promise = sourced("pr1", "A table, fast wifi and coffee made with care");
  d.strategy.values = [sourced("v1", { name: "Care" }), sourced("v2", { name: "Calm" })];
  d.verbal.voice = sourced("vo1", "Warm and plain, never pushy");
  d.verbal.weAreWeAreNot = [sourced("w1", { weAre: "warm", weAreNot: "loud" })];
  d.verbal.forbiddenWords = ["excellence"];
  return d;
}

function input(over: Partial<BookInput> = {}): BookInput {
  return {
    clientName: "Caffè Test",
    agencyName: "Studio Forge",
    versionNumber: 3,
    date: new Date("2026-10-01T00:00:00Z"),
    language: "en",
    document: fullDocument(),
    tokens: defaultTokens(),
    colors: { background: "#FFFFFF", "text.primary": "#111111", accent: "#C0392B" },
    sections: bookSections,
    ...over,
  };
}

describe("fitText", () => {
  it("keeps short text and cuts long text at a word", () => {
    expect(fitText("  short   text ", 20)).toBe("short text");
    expect(fitText("one two three four five six", 15)).toBe("one two three…");
    expect(fitText("a == b", 20)).toBe("a = b");
  });
});

describe("brand book pages", () => {
  let manifest: TemplateManifest;
  beforeAll(async () => {
    manifest = packageFromFiles(await readTemplateDir(TEMPLATE)).manifest;
  });

  it("builds a book the repository template accepts", () => {
    const { slides, dropped } = bookSlides(input(), manifest);
    expect(dropped).toBe(0);
    const check = buildCarouselSchema(manifest).safeParse(slides);
    expect(check.success ? [] : check.error.issues).toEqual([]);
    const roles = slides.map((s) => manifest.layouts.find((l) => l.id === s.layout)?.role);
    expect(roles[0]).toBe("cover");
    expect(roles[1]).toBe("contents");
    expect(roles.at(-1)).toBe("signature");
    expect(roles).toContain("palette");
  });

  it("signs the footer with the agency, and leaves the signature out without one", () => {
    const signed = bookSlides(input(), manifest).slides;
    expect(JSON.stringify(signed)).toContain("Studio Forge");
    const unsigned = bookSlides(input({ agencyName: null }), manifest).slides;
    const last = unsigned.at(-1)!;
    expect(manifest.layouts.find((l) => l.id === last.layout)?.role).not.toBe("signature");
  });

  it("only includes the chosen sections", () => {
    const { slides } = bookSlides(input({ sections: ["strategy"] }), manifest);
    const text = JSON.stringify(slides);
    expect(text).toContain("Good coffee for people who work");
    expect(text).not.toContain("Warm and plain");
  });

  it("writes the labels in the book's language", () => {
    const it_ = JSON.stringify(bookSlides(input({ language: "it" }), manifest).slides);
    const en = JSON.stringify(bookSlides(input(), manifest).slides);
    expect(it_).not.toEqual(en);
    expect(it_).toContain("Good coffee for people who work");
  });

  it("reports the sections an empty version has nothing for", () => {
    const { sections: _ignored, ...rest } = input({ document: emptyDocument() });
    const empty = emptyBookSections(rest);
    expect(empty).toEqual(expect.arrayContaining(["strategy", "verbal", "content"]));
    expect(empty).not.toContain("visual");
    const { sections: _all, ...full } = input();
    expect(emptyBookSections(full)).not.toContain("strategy");
  });
});
