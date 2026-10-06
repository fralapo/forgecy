import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultTokens, parseDocument as parseBrandDocument } from "@forgecy/brand";
import { findLayout, templateManifestSchema } from "@forgecy/carousel";
import { describe, expect, it } from "vitest";
import { imageSize } from "../src/assets";
import { findingsToAcknowledge, toGuardContent } from "../src/brand-guard";
import { computeChecks } from "../src/checks";
import { carouselDocumentSchema, normalizeHashtag, perWeek } from "../src/document";
import { slotsFromOutput } from "../src/pipeline";
import { clampSlideCount, defaultRoles, pickLayout } from "../src/templates";
import { brandThemeFromIdentity } from "../src/theme";

const manifest = templateManifestSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../../templates/editorial-ig-4x5/template.json"),
      "utf8",
    ),
  ),
);

const doc = (slides: unknown[], extra: Record<string, unknown> = {}) =>
  carouselDocumentSchema.parse({ title: "T", slides, ...extra });

const cover = { id: "s1", layout: "cover", slots: { title: "Come scegliere" } };
const text = (id: string) => ({
  id,
  layout: "text",
  slots: { title: "Punto", body: "Spiegazione breve." },
});
const cta = { id: "s9", layout: "cta", slots: { title: "Scrivici", action: "Contattaci" } };
const body = [text("s2"), text("s3"), text("s4")];

describe("templates", () => {
  it("clamps the slide count to the template range", () => {
    expect(clampSlideCount(manifest, 2)).toBe(manifest.slides.min);
    expect(clampSlideCount(manifest, 50)).toBe(manifest.slides.max);
    expect(clampSlideCount(manifest, null)).toBe(manifest.slides.default);
  });

  it("puts cover first and CTA last, respecting positions", () => {
    const roles = defaultRoles(manifest, 7);
    expect(roles[0]).toBe("cover");
    expect(roles[6]).toBe("cta");
    expect(roles.slice(1, 6)).not.toContain("cta");
    // A CTA asked in the middle falls back to a layout allowed there.
    expect(pickLayout(manifest, "cta", 2, 7).role).not.toBe("cta");
    expect(pickLayout(manifest, "cover", 0, 7, "cover").id).toBe("cover");
  });
});

describe("checks", () => {
  it("passes a valid carousel", () => {
    const checks = computeChecks({
      document: doc([cover, ...body, cta]),
      manifest,
      channel: "instagram",
    });
    expect(checks).toEqual([]);
  });

  it("blocks template violations and over-long captions", () => {
    const long = { id: "s5", layout: "text", slots: { title: "x".repeat(61), body: "ok" } };
    const checks = computeChecks({
      document: doc([cover, long, ...body, cta], { caption: "a".repeat(2201) }),
      manifest,
      channel: "instagram",
    });
    expect(checks.some((c) => c.id.startsWith("template:s5:") && c.severity === "error")).toBe(
      true,
    );
    expect(checks.some((c) => c.id === "caption:length")).toBe(true);
    // LinkedIn allows 3000.
    const li = computeChecks({
      document: doc([cover, ...body, cta], { caption: "a".repeat(2500) }),
      manifest,
      channel: "linkedin",
    });
    expect(li.some((c) => c.id === "caption:length")).toBe(false);
  });

  it("warns on forbidden words, prices and a missing final CTA", () => {
    const priced = {
      id: "s5",
      layout: "text",
      slots: { title: "Offerta", body: "Solo 19,90 € e gratis la spedizione" },
    };
    const checks = computeChecks({
      document: doc([cover, priced, ...body]),
      manifest,
      channel: "instagram",
      forbiddenWords: ["gratis"],
    });
    const ids = checks.map((c) => c.id);
    expect(ids).toContain("forbidden:s5:gratis");
    expect(ids).toContain("price:s5");
    expect(ids).toContain("cta:last");
    expect(checks.find((c) => c.id === "forbidden:s5:gratis")?.severity).toBe("warning");
    // Allowed by the brief: no price warning.
    const allowed = computeChecks({
      document: doc([cover, priced, ...body, cta]),
      manifest,
      channel: "instagram",
      usePrice: true,
    });
    expect(allowed.some((c) => c.id.startsWith("price:"))).toBe(false);
  });

  it("blocks AI images still in draft and flags unverified commercial use", () => {
    const withImage = {
      id: "s1",
      layout: "cover",
      slots: { title: "Ciao", image: { key: "clients/x/assets/a.png", alt: "" } },
    };
    const checks = computeChecks({
      document: doc([withImage, ...body, cta]),
      manifest,
      channel: "instagram",
      wantsAltText: true,
      assets: new Map([
        [
          "clients/x/assets/a.png",
          { status: "draft", source: "ai", commercialUsePending: true, alt: "" },
        ],
      ]),
    });
    const byId = new Map(checks.map((c) => [c.id, c.severity]));
    expect(byId.get("asset:unapproved:s1:image")).toBe("error");
    expect(byId.get("asset:commercial:s1:image")).toBe("warning");
    expect(byId.get("asset:alt:s1:image")).toBe("warning");
  });
});

describe("pipeline helpers", () => {
  it("maps flat model slots onto the layout, keeping protected ones", () => {
    const layout = findLayout(manifest, "list")!;
    const slots = slotsFromOutput(layout, [
      { name: "title", text: "Tre motivi", items: [] },
      { name: "items", text: "", items: ["Uno", " ", "Due"] },
      { name: "ghost", text: "ignorato", items: [] },
    ]);
    expect(slots).toEqual({ title: "Tre motivi", items: ["Uno", "Due"] });
    const kept = slotsFromOutput(layout, [{ name: "title", text: "Nuovo", items: [] }], {
      title: "Vecchio",
    });
    expect(kept.title).toBe("Vecchio");
  });
});

describe("document helpers", () => {
  it("normalizes hashtags and frequencies", () => {
    expect(normalizeHashtag("##Design Thinking")).toBe("#DesignThinking");
    expect(normalizeHashtag("  ")).toBe("");
    expect(perWeek({ count: 2, unit: "week" })).toBe(2);
    expect(perWeek({ count: 52, unit: "month" })).toBeCloseTo(12);
  });
});

describe("brand theme", () => {
  it("maps semantic tokens to renderer color roles and keeps keys of the client", () => {
    const document = parseBrandDocument({
      visual: {
        typography: [
          {
            id: "t1",
            value: {
              role: "display",
              family: "Inter Display",
              weights: [400, 800],
              sourceId: "f1",
            },
          },
        ],
        logo: { variants: [{ id: "l1", role: "logo_primary", sourceId: "l1src" }] },
      },
    });
    const theme = brandThemeFromIdentity(
      { clientId: "c1", number: 3, document, tokens: defaultTokens() },
      {
        name: "Acme",
        sourceKeys: new Map([
          ["f1", "clients/c1/brand/font.woff2"],
          ["l1src", "clients/other/brand/logo.png"],
        ]),
      },
    );
    expect(theme.colors.background).toBe("#FFFFFF");
    expect(theme.colors["text.primary"]).toBe("#1A1A1A");
    expect(theme.colors["cta.text"]).toBe("#FFFFFF");
    expect(theme.fonts.heading).toMatchObject({ family: "Inter Display", weight: "400 800" });
    expect(theme.fonts.body).toBeUndefined();
    // A logo stored under another client is never referenced.
    expect(theme.logo).toBeUndefined();
    expect(theme.version).toBe("v3");
  });
});

describe("image size", () => {
  it("reads PNG and GIF headers", () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 1080);
    new DataView(png.buffer).setUint32(20, 1350);
    expect(imageSize(png)).toEqual({ width: 1080, height: 1350 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0, 0x20, 0, 0, 0]);
    expect(imageSize(gif)).toEqual({ width: 16, height: 32 });
  });
});

describe("brand guard mapping", () => {
  it("describes slots with the template limits and AI images with their approval", () => {
    const withImage = {
      id: "s1",
      layout: "cover",
      slots: { title: "Ciao", image: { key: "clients/x/assets/a.png", alt: "" } },
    };
    const content = toGuardContent({
      document: doc([withImage, ...body, cta], { caption: "Testo", hashtags: ["#a"] }),
      manifest,
      channel: "instagram",
      assets: new Map([
        [
          "clients/x/assets/a.png",
          { id: "a1", source: "ai", status: "draft", width: 1024, height: 1024 },
        ],
      ]),
      product: {
        id: "p1",
        name: "Borraccia",
        sku: null,
        category: null,
        price: "19,90 €",
        description: "Acciaio inox, 750 ml",
        highlights: ["Tiene il freddo 24 ore"],
        revision: 1,
        images: [],
      },
    });
    expect(content.size).toEqual({ width: manifest.width, height: manifest.height });
    expect(content.slides[0]!.role).toBe("cover");
    expect(content.slides.at(-1)!.role).toBe("cta");
    const title = content.slides[0]!.slots.find((x) => x.name === "title");
    expect(title).toMatchObject({ kind: "text", role: "title", text: "Ciao" });
    expect(title && "maxChars" in title && title.maxChars).toBeGreaterThan(0);
    const image = content.slides[0]!.slots.find((x) => x.kind === "image");
    expect(image).toMatchObject({ asset: { id: "a1", origin: "ai", approval: "draft" } });
    expect(content.product).toMatchObject({ name: "Borraccia", price: "19,90 €" });
    expect(content.brief).toEqual({ asksPrice: false });
  });

  it("asks «Ho visto» only on open errors and warnings", () => {
    const f = (
      key: string,
      severity: "error" | "warning" | "note",
      status: "open" | "ignored",
    ) => ({
      key,
      check: "x",
      category: "editorial",
      severity,
      slide: null,
      slot: null,
      message: "",
      status,
    });
    const keys = findingsToAcknowledge({
      checkedAt: "",
      coherence: { band: "buono" },
      notRun: [],
      findings: [f("a", "error", "open"), f("b", "note", "open"), f("c", "warning", "ignored")],
    }).map((x) => x.key);
    expect(keys).toEqual(["a"]);
  });
});
