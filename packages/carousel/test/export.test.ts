import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NEUTRAL_BRAND } from "../src/brand";
import {
  captureSlides,
  exportCarousel,
  launchRenderBrowser,
  renderCheckTemplate,
} from "../src/export";
import { sha256 } from "@forgecy/files";
import { packageFromFiles } from "../src/package";
import { renderSlideHtml } from "../src/renderer";
import { sampleSlide, slideSchema } from "../src/slide-schema";
import { validateTemplatePackage } from "../src/validate";
import { loadRepoTemplate, miniPackage } from "./helpers";

/**
 * Chromium tests. CI installs the browser; locally they run when FORGECY_CHROMIUM_PATH
 * points at a Chromium (or Playwright's own browser is installed).
 */
const enabled = Boolean(
  process.env.CI || process.env.FORGECY_CHROMIUM_PATH || process.env.FORGECY_RENDER_TESTS,
);

function pngSize(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

describe.skipIf(!enabled)("export with Chromium", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchRenderBrowser();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("exports PNG, PDF and ZIP with exact sizes, names and identical bytes on every run", async () => {
    const pkg = await loadRepoTemplate("carousels/editorial-ig-4x5");
    const ids = ["cover", "text", "list", "data", "cta"];
    const slides = ids.map((id) => sampleSlide(pkg.manifest.layouts.find((l) => l.id === id)!));
    const input = {
      pkg,
      slides,
      brand: NEUTRAL_BRAND,
      outputs: ["zip" as const],
      meta: {
        client: "Rossi S.r.l.",
        content: "Electronic invoice",
        version: 3,
        approvedAt: "2026-10-04T10:00:00.000Z",
        models: ["test-model"],
      },
      texts: { caption: "Five checks before sending.", hashtags: ["invoice", "#smb"] },
    };
    const percents: number[] = [];
    const a = await exportCarousel(browser, {
      ...input,
      onProgress: (p) => void percents.push(p),
    });
    const b = await exportCarousel(browser, input);

    expect(a.files.map((f) => f.name)).toEqual([
      "rossi-srl_electronic-invoice_v3_ig-4x5_01.png",
      "rossi-srl_electronic-invoice_v3_ig-4x5_02.png",
      "rossi-srl_electronic-invoice_v3_ig-4x5_03.png",
      "rossi-srl_electronic-invoice_v3_ig-4x5_04.png",
      "rossi-srl_electronic-invoice_v3_ig-4x5_05.png",
      "rossi-srl_electronic-invoice_v3_ig-4x5.pdf",
      "rossi-srl_electronic-invoice_v3_ig-4x5.zip",
    ]);
    expect(a.files.map((f) => sha256(f.data))).toEqual(b.files.map((f) => sha256(f.data)));
    expect(a.issues).toEqual([]);
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    for (const f of a.files.filter((f) => f.kind === "png"))
      expect(pngSize(f.data)).toEqual({ width: 1080, height: 1350 });

    const pdf = await PDFDocument.load(a.files.find((f) => f.kind === "pdf")!.data);
    expect(pdf.getPageCount()).toBe(5);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 1080, height: 1350 });
    expect(pdf.getKeywords()).toContain("template:editorial-ig-4x5@1.2.1");

    const zip = unzipSync(a.files.find((f) => f.kind === "zip")!.data);
    expect(Object.keys(zip)).toEqual([
      ...a.files.slice(0, 6).map((f) => f.name),
      "caption.txt",
      "texts.md",
      "slides.json",
    ]);
    expect(new TextDecoder().decode(zip["caption.txt"])).toBe(
      "Five checks before sending.\n\n#invoice #smb\n",
    );
    expect(new TextDecoder().decode(zip["texts.md"])).toContain(
      (slides[0]!.slots.title as string).replace(/==/g, ""),
    );
    const json = JSON.parse(new TextDecoder().decode(zip["slides.json"]));
    expect(json.template).toEqual({
      id: "editorial-ig-4x5",
      version: pkg.manifest.version,
      name: pkg.manifest.name,
    });
    expect(json.slides).toHaveLength(5);
  }, 120_000);

  it("exports the audit report as an A4 PDF", async () => {
    const pkg = await loadRepoTemplate("reports/report-audit-a4");
    const slides = pkg.manifest.layouts.map(sampleSlide);
    const out = await exportCarousel(browser, {
      pkg,
      slides,
      brand: NEUTRAL_BRAND,
      outputs: ["pdf"],
      meta: { client: "Rossi", content: "Audit", version: 1 },
    });
    expect(out.issues).toEqual([]);
    expect(out.files.map((f) => f.name)).toEqual(["rossi_audit_v1_report-a4.pdf"]);
    const pdf = await PDFDocument.load(out.files[0]!.data);
    expect(pdf.getPageCount()).toBe(6);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  }, 120_000);

  it("watermarks and renames a draft preview", async () => {
    const pkg = await loadRepoTemplate("carousels/editorial-linkedin");
    const slides = pkg.manifest.layouts.slice(0, 5).map(sampleSlide);
    slides.push(sampleSlide(pkg.manifest.layouts.at(-1)!));
    const draft = await exportCarousel(browser, {
      pkg,
      slides,
      brand: NEUTRAL_BRAND,
      outputs: ["pdf"],
      draft: true,
      meta: { client: "Rossi", content: "Doc", version: 1 },
    });
    const final = await exportCarousel(browser, {
      pkg,
      slides,
      brand: NEUTRAL_BRAND,
      outputs: ["pdf"],
      meta: { client: "Rossi", content: "Doc", version: 1 },
    });
    expect(draft.files.map((f) => f.name)).toEqual(["rossi_doc_v1_linkedin-doc_draft.pdf"]);
    expect(final.files.map((f) => f.name)).toEqual(["rossi_doc_v1_linkedin-doc.pdf"]);
    expect(sha256(draft.files[0]!.data)).not.toBe(sha256(final.files[0]!.data));
  }, 120_000);

  it("finds text that overflows its box, leaves the safe zone or overlaps", async () => {
    const files = miniPackage({
      css: `.box{position:absolute;inset:0;font-size:64px;color:var(--fc-text)}\n[data-slot="title"]{position:absolute;left:0;top:0;width:300px;height:80px;overflow:hidden}\n[data-slot="items"]{position:absolute;left:0;top:20px;margin:0}`,
    });
    const pkg = packageFromFiles(files);
    const slide = slideSchema.parse({
      layout: "only",
      slots: { title: "A title that is far too long", items: ["overlapping"] },
    });
    const [cap] = await captureSlides(browser, [
      {
        rendered: renderSlideHtml({ pkg, slide }),
        safeZone: { top: 80, right: 64, bottom: 120, left: 64 },
      },
    ]);
    const kinds = cap!.issues.map((i) => `${i.slot}:${i.kind}`);
    expect(kinds).toContain("title:overflow");
    expect(kinds).toContain("title:outside_safe_zone");
    expect(kinds).toContain("title:overlap");
  }, 60_000);

  it("runs the template editor render checks", async () => {
    const pkg = await loadRepoTemplate("carousels/editorial-ig-4x5");
    const report = await renderCheckTemplate(browser, pkg, validateTemplatePackage(pkg.files));
    expect(
      report.checks.filter((c) => c.id === "render" || c.id === "overflow").map((c) => c.label),
    ).toEqual([
      `Test render: ${pkg.manifest.layouts.length} layouts without errors`,
      "Long text: no overflow",
    ]);
    expect(report.ok).toBe(true);
  }, 120_000);
});
