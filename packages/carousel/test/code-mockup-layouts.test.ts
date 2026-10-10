import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { renderSlideHtml } from "../src/renderer";
import { buildSlideSchema, sampleSlide, slideSchema } from "../src/slide-schema";
import { findLayout } from "../src/template-schema";
import { loadRepoTemplate } from "./helpers";

const FOLDERS = ["carousels/editorial-ig-4x5", "carousels/editorial-linkedin"];

describe.each(FOLDERS)("code and mockup layouts of %s", (folder) => {
  it("ships both layouts as text-role layouts in a bumped version", async () => {
    const { manifest } = await loadRepoTemplate(folder);
    expect(manifest.version).toBe("1.3.0");
    for (const id of ["code", "mockup"]) expect(findLayout(manifest, id)?.role).toBe("text");
    // The text role still resolves to the plain text layout first.
    expect(manifest.layouts.find((l) => l.role === "text")?.id).toBe("text");
  });

  it("renders the code as escaped text in a single slot", async () => {
    const pkg = await loadRepoTemplate(folder);
    const slide = slideSchema.parse({
      layout: "code",
      slots: { title: "Escape it", code: `<script>alert(1)</script>\n  indented();` },
    });
    const { html, warnings } = renderSlideHtml({ pkg, slide });
    expect(warnings).toEqual([]);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/<script>alert/);
    const code = parseHTML(html).document.querySelector('[data-slot="code"]');
    expect(code?.textContent).toBe("<script>alert(1)</script>\n  indented();");
    expect(html).toMatch(/\.code-text\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it("enforces the 8 line limit of the code slot", async () => {
    const { manifest } = await loadRepoTemplate(folder);
    const layout = findLayout(manifest, "code")!;
    const slot = layout.slots.find((s) => s.name === "code");
    expect(slot).toMatchObject({ type: "text", maxLines: 8, required: true });
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`).join("\n");
    const result = (n: number) =>
      buildSlideSchema(manifest).safeParse({
        layout: "code",
        slots: { title: "T", code: lines(n) },
      });
    expect(result(8).success).toBe(true);
    expect(result(9).success).toBe(false);
  });

  it("draws the phone frame around the screen image", async () => {
    const pkg = await loadRepoTemplate(folder);
    const layout = findLayout(pkg.manifest, "mockup")!;
    const { html, warnings } = renderSlideHtml({ pkg, slide: sampleSlide(layout) });
    expect(warnings).toEqual([]);
    const doc = parseHTML(html).document;
    const screen = doc.querySelector('.phone [data-slot="screen"]');
    expect(screen?.getAttribute("src")).toMatch(/^data:image\//);
    expect(html).not.toMatch(/(?:src|href)="(?!data:|#)|url\((?!"?data:)/);
  });

  it("renders every sample deterministically", async () => {
    const pkg = await loadRepoTemplate(folder);
    for (const id of ["code", "mockup"]) {
      const slide = sampleSlide(findLayout(pkg.manifest, id)!);
      const a = renderSlideHtml({ pkg, slide, index: 2, total: 7 });
      expect(a.html).toBe(renderSlideHtml({ pkg, slide, index: 2, total: 7 }).html);
    }
  });
});
