import { parseHTML } from "linkedom";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureSlides, launchRenderBrowser } from "../src/export";
import { renderSlideHtml } from "../src/renderer";
import { buildSlideSchema, sampleSlide, slideSchema } from "../src/slide-schema";
import { findLayout } from "../src/template-schema";
import { loadRepoTemplate } from "./helpers";

const FOLDERS = [
  "carousels/editorial-ig-4x5",
  "carousels/editorial-linkedin",
  "carousels/editorial-fb-4x5",
];
const NEW_LAYOUTS = {
  breather: "text",
  evidence: "text",
  takeaway: "text",
  steps: "list",
  "cover-photo": "cover",
  "cover-statement": "cover",
  "cta-single": "cta",
  "cta-conclusion": "cta",
} as const;

const enabled = Boolean(
  process.env.CI || process.env.FORGECY_CHROMIUM_PATH || process.env.FORGECY_RENDER_TESTS,
);

describe.each(FOLDERS)("factory layouts of %s", (folder) => {
  it("declares the eight layouts with their roles, useWhen and default role layouts intact", async () => {
    const { manifest } = await loadRepoTemplate(folder);
    expect(manifest.version).toBe(folder.endsWith("fb-4x5") ? "1.1.0" : "1.4.0");
    expect(manifest.layouts).toHaveLength(18);
    for (const [id, role] of Object.entries(NEW_LAYOUTS)) {
      const layout = findLayout(manifest, id)!;
      expect(layout.role, id).toBe(role);
      expect(layout.useWhen, id).toBeTruthy();
    }
    // The first layout of each role stays the plain one.
    for (const [role, id] of [
      ["text", "text"],
      ["list", "list"],
      ["cover", "cover"],
      ["cta", "cta"],
    ])
      expect(manifest.layouts.find((l) => l.role === role)?.id).toBe(id);
  });

  it("renders every new layout from its sample without warnings", async () => {
    const pkg = await loadRepoTemplate(folder);
    for (const id of Object.keys(NEW_LAYOUTS)) {
      const slide = sampleSlide(findLayout(pkg.manifest, id)!);
      const r = renderSlideHtml({ pkg, slide, index: 1, total: 6 });
      expect(r.warnings, id).toEqual([]);
      expect(r.html.length, id).toBeGreaterThan(1000);
      const doc = parseHTML(r.html).document;
      expect(doc.querySelector(`.fc-slide[data-layout="${id}"]`), id).not.toBeNull();
      // Every slot with a sample value is filled.
      for (const name of Object.keys(slide.slots)) {
        const el = doc.querySelector(`[data-slot="${name}"]`);
        expect(el?.hasAttribute("data-empty"), `${id}.${name}`).toBe(false);
      }
    }
  });

  it("shows the evidence detail circle only when it has text", async () => {
    const pkg = await loadRepoTemplate(folder);
    const slide = slideSchema.parse({ layout: "evidence", slots: { body: "Hello" } });
    const doc = parseHTML(renderSlideHtml({ pkg, slide }).html).document;
    expect(doc.querySelector('[data-slot="detail"]')?.hasAttribute("data-empty")).toBe(true);
  });

  it("prints the takeaway label in the deliverable's language", async () => {
    const pkg = await loadRepoTemplate(folder);
    const slide = sampleSlide(findLayout(pkg.manifest, "takeaway")!);
    const label = (language: "en" | "it") =>
      parseHTML(renderSlideHtml({ pkg, slide, language }).html).document.querySelector(
        ".takeaway-label",
      )?.textContent;
    expect(label("en")).toBe("In plain words");
    expect(label("it")).toBe("Tradotto");
  });

  it("turns the || marker of a title into a <br> and never into markup", async () => {
    const pkg = await loadRepoTemplate(folder);
    const slide = slideSchema.parse({
      layout: "breather",
      slots: { title: `One <b>x</b>||==two== <img src=x onerror=1>` },
    });
    const { html } = renderSlideHtml({ pkg, slide });
    const title = parseHTML(html).document.querySelector('[data-slot="title"]')!;
    expect(title.querySelectorAll("br")).toHaveLength(1);
    expect(title.querySelectorAll("mark.fc-hl")).toHaveLength(1);
    expect(title.querySelector("b")).toBeNull();
    expect(title.querySelector("img")).toBeNull();
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x onerror=1&gt;");
    // A slot without highlights keeps the marker as plain text.
    const code = slideSchema.parse({ layout: "code", slots: { title: "T", code: "a || b" } });
    const codeEl = parseHTML(renderSlideHtml({ pkg, slide: code }).html).document.querySelector(
      '[data-slot="code"]',
    )!;
    expect(codeEl.textContent).toContain("||");
    expect(codeEl.querySelector("br")).toBeNull();
  });

  it("counts the || marker as a line break for the line limit", async () => {
    const { manifest } = await loadRepoTemplate(folder);
    const schema = buildSlideSchema(manifest);
    const title = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join("||");
    // breather title: at most 5 lines
    expect(schema.safeParse({ layout: "breather", slots: { title: title(5) } }).success).toBe(true);
    expect(schema.safeParse({ layout: "breather", slots: { title: title(6) } }).success).toBe(
      false,
    );
  });

  it("accepts the accent tone and styles it", async () => {
    const pkg = await loadRepoTemplate(folder);
    const slide = slideSchema.parse({ layout: "breather", tone: "accent", slots: { title: "Hi" } });
    const { html } = renderSlideHtml({ pkg, slide });
    expect(html).toContain('data-tone="accent"');
    expect(html).toContain('[data-tone="accent"] .frame');
  });
});

describe.skipIf(!enabled)("factory layouts in Chromium", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchRenderBrowser();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it.each(FOLDERS)(
    "captures every new layout of %s at the template size",
    async (folder) => {
      const pkg = await loadRepoTemplate(folder);
      const ids = Object.keys(NEW_LAYOUTS);
      const caps = await captureSlides(
        browser,
        ids.map((id) => ({
          rendered: renderSlideHtml({
            pkg,
            slide: sampleSlide(findLayout(pkg.manifest, id)!),
            index: 1,
            total: 6,
          }),
          safeZone: { top: 0, right: 0, bottom: 0, left: 0 },
        })),
      );
      expect(caps).toHaveLength(ids.length);
      for (const cap of caps) {
        expect(cap.png.length).toBeGreaterThan(2000);
        const v = new DataView(cap.png.buffer, cap.png.byteOffset);
        expect({ w: v.getUint32(16), h: v.getUint32(20) }).toEqual({
          w: pkg.manifest.width,
          h: pkg.manifest.height,
        });
      }
    },
    180_000,
  );
});
