import { defaultTokens, emptyDocument, type BrandIdentityDocument } from "@forgecy/brand";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  assetRefs,
  brandSystemFileName,
  buildBrandSystemFiles,
  fieldScores,
  flatTokens,
  zipFiles,
  type BrandSystemInput,
} from "../src/system";
import { brandSystemParts } from "../src/parts";

const sourced = <T>(id: string, value: T, confidence: "high" | "medium" | "low" = "high") => ({
  id,
  value,
  sourceIds: ["s1"],
  confidence,
});

const LOGO = "11111111-aaaa-4aaa-8aaa-111111111111";
const FONT = "22222222-bbbb-4bbb-8bbb-222222222222";

function doc(): BrandIdentityDocument {
  const d = emptyDocument();
  d.strategy.oneLiner = sourced("o1", "Good coffee for people who work");
  d.strategy.values = [
    sourced("v1", { name: "Care" }, "medium"),
    { ...sourced("v2", { name: "Old" }, "low"), deprecated: true },
  ];
  d.verbal.forbiddenWords = ["excellence"];
  d.visual.logo.variants = [{ id: "l1", role: "logo_primary", sourceId: LOGO, background: "any" }];
  d.visual.typography = [
    sourced("t1", {
      role: "display",
      family: "Space Grotesk",
      weights: [700],
      licenseStatus: "verified",
      sourceId: FONT,
    }),
  ];
  return d;
}

function input(over: Partial<BrandSystemInput> = {}): BrandSystemInput {
  return {
    client: { name: "Rossi Srl", slug: "rossi" },
    version: {
      id: "ver-3",
      number: 3,
      publishedAt: new Date("2026-09-01T10:00:00Z"),
      document: doc(),
      tokens: defaultTokens(),
    },
    history: [
      { number: 4, publishedAt: new Date("2026-10-01T10:00:00Z"), changelog: "Later" },
      { number: 3, publishedAt: new Date("2026-09-01T10:00:00Z"), changelog: "New palette" },
      { number: 1, publishedAt: new Date("2026-08-01T10:00:00Z"), changelog: null },
    ],
    sources: [
      {
        id: LOGO,
        kind: "brand_book",
        title: "logo.svg",
        url: null,
        mime: "image/svg+xml",
        size: 10,
        status: "extracted",
        capturedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ],
    examples: [
      {
        id: "e1",
        kind: "caption",
        verdict: "approved",
        body: "Fresh beans",
        reason: "Concrete",
        channel: null,
        pillarKey: null,
        formatKey: null,
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
      {
        id: "e2",
        kind: "caption",
        verdict: "rejected",
        body: "Excellence always",
        reason: "Forbidden word",
        channel: "instagram",
        pillarKey: null,
        formatKey: null,
        createdAt: new Date("2026-08-03T00:00:00Z"),
      },
    ],
    assets: [
      {
        path: "assets/logos/logo-primary-11111111.svg",
        sourceId: LOGO,
        bytes: new Uint8Array([60, 115, 118, 103, 62]),
      },
    ],
    generatedAt: new Date("2026-10-06T12:00:00Z"),
    ...over,
  };
}

const text = (files: Map<string, Uint8Array>, path: string) => strFromU8(files.get(path)!);

describe("buildBrandSystemFiles", () => {
  it("lays out every part with the README first and the internal warning", () => {
    const files = buildBrandSystemFiles(input(), brandSystemParts);
    expect([...files.keys()]).toEqual([
      "README.md",
      "brand_identity.json",
      "tokens.json",
      "tokens.dtcg.json",
      "tokens.css",
      "agent_rules.md",
      "sources.json",
      "scores.json",
      "examples/approved.json",
      "examples/rejected.json",
      "CHANGELOG.md",
      "assets/logos/logo-primary-11111111.svg",
    ]);
    expect(text(files, "README.md")).toContain("Do not share it with the client");
    expect(text(files, "README.md")).toContain("`scores.json`");
  });

  it("keeps only the chosen parts", () => {
    const files = buildBrandSystemFiles(input(), ["tokens"]);
    expect([...files.keys()]).toEqual([
      "README.md",
      "tokens.json",
      "tokens.dtcg.json",
      "tokens.css",
    ]);
  });

  it("writes the agent rules from the stable brand context", () => {
    const rules = text(buildBrandSystemFiles(input(), ["agent_rules"]), "agent_rules.md");
    expect(rules).toContain("# Brand Identity v3");
    expect(rules).toContain("Forbidden words (never use them): excellence");
  });

  it("links sources to the files bundled under assets/", () => {
    const sources = JSON.parse(text(buildBrandSystemFiles(input(), ["sources"]), "sources.json"));
    expect(sources[0]).toMatchObject({ id: LOGO, file: "assets/logos/logo-primary-11111111.svg" });
  });

  it("splits examples by verdict", () => {
    const files = buildBrandSystemFiles(input(), ["examples"]);
    expect(
      JSON.parse(text(files, "examples/approved.json")).map((e: { id: string }) => e.id),
    ).toEqual(["e1"]);
    expect(
      JSON.parse(text(files, "examples/rejected.json")).map((e: { id: string }) => e.id),
    ).toEqual(["e2"]);
  });

  it("lists only versions up to the exported one in the changelog", () => {
    const log = text(buildBrandSystemFiles(input(), ["changelog"]), "CHANGELOG.md");
    expect(log).not.toContain("Version 4");
    expect(log).toContain("## Version 3");
    expect(log).toContain("New palette");
    expect(log).toContain("No changelog.");
  });

  it("zips to the same bytes for the same input", () => {
    const a = zipFiles(buildBrandSystemFiles(input(), brandSystemParts), "rossi");
    const b = zipFiles(buildBrandSystemFiles(input(), brandSystemParts), "rossi");
    expect(a).toEqual(b);
    const unzipped = unzipSync(a);
    expect(Object.keys(unzipped)).toContain("rossi/brand_identity.json");
  });
});

describe("fieldScores", () => {
  it("reports live sourced fields with their pointer and label, skipping deprecated ones", () => {
    const scores = fieldScores(doc());
    expect(scores).toContainEqual({
      pointer: "/document/strategy/oneLiner",
      label: "Strategy › One-liner",
      confidence: "high",
      sourceIds: ["s1"],
    });
    expect(scores.find((s) => s.pointer === "/document/strategy/values/0")?.confidence).toBe(
      "medium",
    );
    expect(scores.some((s) => s.pointer === "/document/strategy/values/1")).toBe(false);
  });
});

describe("flatTokens", () => {
  it("resolves aliases and gives colors as hex", () => {
    const flat = flatTokens(defaultTokens());
    const color = Object.entries(flat).find(([p]) => p.startsWith("color.semantic."));
    expect(color?.[1].value).toMatch(/^#[0-9A-Fa-f]{6}/);
  });
});

describe("assetRefs", () => {
  it("maps logo and font sources to stable paths, skipping unknown ones", () => {
    expect(
      assetRefs(doc(), [
        { id: LOGO, title: "Logo final", mime: "image/svg+xml" },
        { id: FONT, title: "SpaceGrotesk-Bold.TTF", mime: null },
      ]),
    ).toEqual([
      { sourceId: LOGO, path: "assets/logos/logo-primary-11111111.svg" },
      { sourceId: FONT, path: "assets/fonts/space-grotesk-22222222.ttf" },
    ]);
    expect(assetRefs(doc(), [])).toEqual([]);
  });
});

it("names the file after client, version and BB number", () => {
  expect(brandSystemFileName("Rossi Srl", 3, 7)).toBe("rossi-srl-brand-system-v3-bb7.zip");
});
