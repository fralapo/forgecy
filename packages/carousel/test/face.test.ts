import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureSlides, launchRenderBrowser } from "../src/export";
import { renderSlideHtml } from "../src/renderer";
import { loadRepoTemplate } from "./helpers";
import { issuesFromMeasures, type SlotMeasure } from "../src/export/capture";
import { FACE_MAX_COVERED, faceCoveredPercent, faceRectOnSlide } from "../src/typography/face";
import { slideSchema } from "../src/slide-schema";

const box = { x: 0, y: 0, width: 1000, height: 1000 };

describe("faceRectOnSlide", () => {
  it("maps fractions on a photo that fits exactly", () => {
    const r = faceRectOnSlide(
      { cx: 0.5, cy: 0.25, w: 0.2, h: 0.1 },
      { width: 500, height: 500 },
      box,
    );
    expect(r).toEqual({ x: 400, y: 200, width: 200, height: 100 });
  });

  it("accounts for the cover crop and the focal point", () => {
    // 2000x1000 photo in a square: scaled to 1000 high, 2000 wide, 1000 px cut sideways.
    const face = { cx: 0.75, cy: 0.5, w: 0.1, h: 0.2 };
    const photo = { width: 2000, height: 1000 };
    expect(faceRectOnSlide(face, photo, box)).toEqual({ x: 900, y: 400, width: 200, height: 200 });
    // Focal point on the left edge: nothing cut on the left, the face sits further right.
    expect(faceRectOnSlide(face, photo, box, { x: 0, y: 0.5 })?.x).toBe(1400);
    // Focal point on the right edge: further left.
    expect(faceRectOnSlide(face, photo, box, { x: 1, y: 0.5 })?.x).toBe(400);
  });

  it("gives nothing for an empty photo or box", () => {
    expect(
      faceRectOnSlide({ cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 }, { width: 0, height: 0 }, box),
    ).toBeNull();
  });
});

describe("faceCoveredPercent", () => {
  const face = { x: 100, y: 100, width: 100, height: 100 };
  it("is silent at or under the limit and speaks above it", () => {
    expect(FACE_MAX_COVERED).toBe(0.12);
    // 12% exactly: 100 x 12 strip.
    expect(faceCoveredPercent({ x: 0, y: 100, width: 1000, height: 12 }, face)).toBeNull();
    expect(faceCoveredPercent({ x: 0, y: 100, width: 1000, height: 13 }, face)).toBe(13);
  });
  it("is silent when the boxes do not touch", () => {
    expect(faceCoveredPercent({ x: 300, y: 300, width: 50, height: 50 }, face)).toBeNull();
    expect(faceCoveredPercent({ x: 200, y: 100, width: 50, height: 50 }, face)).toBeNull();
  });
  it("reports the whole face covered as 100", () => {
    expect(faceCoveredPercent({ x: 0, y: 0, width: 500, height: 500 }, face)).toBe(100);
  });
});

const rect = { x: 0, y: 0, width: 1000, height: 1000 };
const m = (over: Partial<SlotMeasure>): SlotMeasure => ({
  name: "title",
  kind: "text",
  overflow: false,
  outsideSlide: false,
  outsideSafe: false,
  lines: 1,
  naturalWidth: 0,
  naturalHeight: 0,
  rect,
  ...over,
});
const photo = m({
  name: "image",
  kind: "image",
  naturalWidth: 1000,
  naturalHeight: 1000,
  face: { cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 },
  focal: { x: 0.5, y: 0.5 },
});
const title = m({ rect: { x: 0, y: 450, width: 1000, height: 100 } });

describe("text_over_face render issue", () => {
  const run = (slide: number, slots: SlotMeasure[], language?: "en") =>
    issuesFromMeasures(slide, slots, {}, language).filter((i) => i.kind === "text_over_face");

  it("is an error on the cover and a warning elsewhere", () => {
    expect(run(0, [photo, title], "en")[0]).toMatchObject({
      slot: "title",
      severity: "error",
      message: "“title” covers 50% of the face in “image”: move the text or the photo.",
    });
    expect(run(2, [photo, title], "en")[0]?.severity).toBe("warning");
  });
  it("is silent without a face box, without a language (reports) or when text is clear", () => {
    expect(run(0, [{ ...photo, face: undefined }, title], "en")).toEqual([]);
    expect(run(0, [photo, title])).toEqual([]);
    expect(run(0, [photo, m({ rect: { x: 0, y: 0, width: 1000, height: 100 } })], "en")).toEqual(
      [],
    );
  });
});

describe("face on the image slot", () => {
  it("validates, and old data without a face still does", () => {
    const base = { asset: "a.png", alt: "" };
    const ok = (image: unknown) => slideSchema.safeParse({ layout: "x", slots: { image } }).success;
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, face: { cx: 0.5, cy: 0.4, w: 0.2, h: 0.3 } })).toBe(true);
    expect(ok({ ...base, face: { cx: 1.5, cy: 0.4, w: 0.2, h: 0.3 } })).toBe(false);
  });
});

const enabled = Boolean(
  process.env.CI || process.env.FORGECY_CHROMIUM_PATH || process.env.FORGECY_RENDER_TESTS,
);

describe.skipIf(!enabled)("text over a face with Chromium", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchRenderBrowser();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("flags the cover title over a declared face, and is silent without one", async () => {
    const pkg = await loadRepoTemplate("carousels/editorial-ig-4x5");
    const layout = pkg.manifest.layouts.find((l) => l.id === "cover-photo")!;
    const shoot = async (face?: { cx: number; cy: number; w: number; h: number }) => {
      const sample = layout.sample as unknown as { image: Record<string, unknown> };
      const slide = slideSchema.parse({
        layout: "cover-photo",
        slots: { ...layout.sample, image: { ...sample.image, ...(face ? { face } : {}) } },
      });
      const [cap] = await captureSlides(browser, [
        {
          rendered: renderSlideHtml({ pkg, slide, language: "en" }),
          safeZone: { top: 80, right: 64, bottom: 120, left: 64 },
          language: "en",
        },
      ]);
      return cap!;
    };
    const plain = await shoot();
    expect(plain.issues.filter((i) => i.kind === "text_over_face")).toEqual([]);

    // Put the face where the title was measured, in the coordinates of the 1080x1350 photo.
    const t = plain.slots.find((s) => s.name === "title")!.rect;
    const cap = await shoot({
      cx: (t.x + t.width / 2) / 1080,
      cy: (t.y + t.height / 2) / 1350,
      w: 0.15,
      h: 0.1,
    });
    const hit = cap.issues.find((i) => i.kind === "text_over_face" && i.slot === "title");
    expect(hit).toMatchObject({ slide: 0, severity: "error" });
    expect(cap.slots.find((s) => s.name === "image")?.face).toBeDefined();
  }, 60_000);
});
