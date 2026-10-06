import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { brandThemeSchema } from "../src/brand";
import { packageFromFiles } from "../src/package";
import { RENDER_CSP, renderSlideHtml } from "../src/renderer";
import { sampleSlide, slideSchema } from "../src/slide-schema";
import { loadRepoTemplate, miniPackage } from "./helpers";

const dom = (html: string) => parseHTML(html).document;
const body = (html: string) => html.slice(html.indexOf("<body>"));
const slide = (slots: Record<string, unknown>, layout = "only") =>
  slideSchema.parse({ layout, slots });

describe("renderSlideHtml", () => {
  it("inserts slot values as text, never as markup", () => {
    const pkg = packageFromFiles(miniPackage());
    const { html } = renderSlideHtml({
      pkg,
      slide: slide({ title: `<img src=x onerror=alert(1)><script>alert(1)</script>` }),
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<img src=x/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("turns ==x== into a highlight span and clones list items", () => {
    const pkg = packageFromFiles(miniPackage());
    const { html } = renderSlideHtml({
      pkg,
      slide: slide({ title: "Uno ==due== tre", items: ["a", "b", "c"] }),
    });
    expect(html).toContain(`Uno <mark class="fc-hl">due</mark> tre`);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain('data-count="3"');
  });

  it("marks empty slots so the layout can hide them", () => {
    const pkg = packageFromFiles(miniPackage());
    const { html } = renderSlideHtml({ pkg, slide: slide({ title: "Solo titolo" }) });
    expect(dom(html).querySelector('[data-slot="items"]')?.hasAttribute("data-empty")).toBe(true);
  });

  it("strips scripts, handlers and remote URLs from the template itself", () => {
    const pkg = packageFromFiles(
      miniPackage({
        html: `<div onclick="x()"><script>evil()</script><iframe src="https://e.vil"></iframe><h1 data-slot="title" style="background:url(https://e.vil/t.png)"></h1><ul data-slot="items"><li></li></ul><a href="https://e.vil">x</a></div>`,
        css: `@import url("https://e.vil/x.css"); .box{background-image:url(https://e.vil/p.png)} </style><script>`,
      }),
    );
    const { html } = renderSlideHtml({ pkg, slide: slide({ title: "Ok" }) });
    expect(html).not.toMatch(/e\.vil/);
    expect(body(html)).not.toMatch(/onclick|<script|<iframe|<a /);
    // A "</style" inside template CSS cannot close the style element.
    expect(html).toContain("<\\/style><script>");
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).toContain(RENDER_CSP);
  });

  it("applies brand colors and fonts as CSS variables, falling back to the template", () => {
    const pkg = packageFromFiles(miniPackage());
    const brand = brandThemeSchema.parse({ colors: { background: "#FFEEDD" } });
    const { html } = renderSlideHtml({ pkg, slide: slide({ title: "x" }), brand });
    expect(html).toContain("--fc-bg:#FFEEDD");
    expect(html).toContain("--fc-text:#111111");
    expect(() => brandThemeSchema.parse({ colors: { accent: "red;}body{x" } })).toThrow();
  });

  it("is deterministic and self-contained for the repository templates", async () => {
    const pkg = await loadRepoTemplate("editoriale-ig-4x5");
    for (const layout of pkg.manifest.layouts) {
      const a = renderSlideHtml({ pkg, slide: sampleSlide(layout), index: 1, total: 7 });
      const b = renderSlideHtml({ pkg, slide: sampleSlide(layout), index: 1, total: 7 });
      expect(a.html).toBe(b.html);
      expect(a.warnings).toEqual([]);
      expect(a.html).not.toMatch(/(?:src|href)="(?!data:|#)|url\((?!"?data:)/);
      expect(a.html).toContain('data-fc="page">02<');
    }
  });

  it("adds the draft watermark and editor overlays only when asked", () => {
    const pkg = packageFromFiles(miniPackage());
    const plain = renderSlideHtml({ pkg, slide: slide({ title: "x" }) }).html;
    expect(plain).not.toContain('class="fc-watermark"');
    const draft = renderSlideHtml({
      pkg,
      slide: slide({ title: "x" }),
      options: { watermark: "Bozza", showSafeZone: true },
    }).html;
    expect(draft).toContain(">Bozza</span>");
    expect(draft).toContain('class="fc-safe"');
  });

  it("warns when an image asset is not resolved instead of fetching it", () => {
    const pkg = packageFromFiles(
      miniPackage({
        html: `<h1 data-slot="title"></h1><ul data-slot="items"><li></li></ul><img data-slot="photo" alt="">`,
        manifest: {
          layouts: [
            {
              id: "only",
              name: "Unico",
              role: "text",
              file: "layouts/only.html",
              slots: [
                { name: "title", type: "text", maxChars: 40 },
                { name: "items", type: "list", maxItems: 3, maxChars: 30 },
                { name: "photo", type: "image" },
              ],
            },
          ],
        },
      }),
    );
    const out = renderSlideHtml({
      pkg,
      slide: slide({ title: "x", photo: { key: "clients/a/assets/b.png" } }),
    });
    expect(out.warnings).toHaveLength(1);
    const img = dom(out.html).querySelector('[data-slot="photo"]');
    expect(img?.hasAttribute("data-empty")).toBe(true);
    expect(img?.hasAttribute("src")).toBe(false);
    const ok = renderSlideHtml({
      pkg,
      slide: slide({
        title: "x",
        photo: { key: "clients/a/assets/b.png", alt: "Foto", focalX: 0.2 },
      }),
      assets: new Map([["clients/a/assets/b.png", "data:image/png;base64,AAAA"]]),
    });
    expect(ok.html).toContain('src="data:image/png;base64,AAAA"');
    expect(ok.html).toContain("object-position:20% 50%");
  });
});
