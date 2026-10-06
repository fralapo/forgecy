import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { checkTemplateTexts, templateLanguages, templateTexts } from "../src/labels";
import { packageFromFiles } from "../src/package";
import { renderSlideHtml } from "../src/renderer";
import { sampleSlide } from "../src/slide-schema";
import { findLayout } from "../src/template-schema";
import { slidesMarkdown } from "../src/texts";
import { loadRepoTemplate, miniPackage } from "./helpers";

const enc = new TextEncoder();
const labelHtml = `<div class="frame"><h1 data-slot="title"></h1><span data-fc-text="swipe">Swipe</span><span data-fc-text="more">More</span></div>`;
const withLocales = (locales: Record<string, string>) =>
  packageFromFiles(
    miniPackage({
      html: labelHtml,
      extra: Object.fromEntries(
        Object.entries(locales).map(([code, json]) => [`locales/${code}.json`, enc.encode(json)]),
      ),
    }),
  );
const text = (html: string, key: string) =>
  parseHTML(html).document.querySelector(`[data-fc-text="${key}"]`)?.textContent;

describe("template labels", () => {
  const pkg = withLocales({
    en: JSON.stringify({ swipe: "Swipe", more: "More" }),
    it: JSON.stringify({ swipe: "Scorri" }),
  });

  it("prints labels in the deliverable's language, English for missing keys", () => {
    const slide = sampleSlide(findLayout(pkg.manifest, "only")!);
    const it = renderSlideHtml({ pkg, slide, language: "it" }).html;
    expect(text(it, "swipe")).toBe("Scorri");
    expect(text(it, "more")).toBe("More");
    expect(it).toContain('<html lang="it">');
    const en = renderSlideHtml({ pkg, slide }).html;
    expect(text(en, "swipe")).toBe("Swipe");
    expect(en).toContain('<html lang="en">');
  });

  it("lists languages and reports broken files and missing English keys", () => {
    expect(templateLanguages(pkg).sort()).toEqual(["en", "it"]);
    expect(templateTexts(pkg, "it")).toEqual({ swipe: "Scorri", more: "More" });
    const broken = withLocales({ en: JSON.stringify({ swipe: "Swipe" }), it: "{nope" });
    expect(checkTemplateTexts(broken)).toEqual([
      { path: "locales/it.json", message: "is not valid JSON" },
      { path: expect.any(String), message: 'label "more" is missing from locales/en.json' },
    ]);
  });

  it.each([
    "carousels/editorial-fb-4x5",
    "carousels/editorial-ig-1x1",
    "carousels/editorial-ig-4x5",
    "carousels/editorial-linkedin",
    "carousels/editorial-stories-9x16",
    "carousels/editorial-tiktok-photo",
    "reports/report-audit-a4",
  ])("%s ships every label in English and Italian", async (folder) => {
    const repo = await loadRepoTemplate(folder);
    expect(checkTemplateTexts(repo)).toEqual([]);
    expect(templateLanguages(repo).sort()).toEqual(["en", "it"]);
    expect(Object.keys(templateTexts(repo, "it")).sort()).toEqual(
      Object.keys(templateTexts(repo, "en")).sort(),
    );
  });
});

describe("texts.md", () => {
  const pkg = packageFromFiles(miniPackage());
  const slides = [{ id: "s1", layout: "only", slots: { title: "Ciao", items: ["Uno"] } }];
  const meta = { client: "Acme", content: "Lancio", version: 2 };
  const texts = { caption: "Didascalia", hashtags: ["acme"] };

  it("writes its labels in the deliverable's language", () => {
    const en = slidesMarkdown(pkg, slides as never, meta, texts);
    expect(en).toContain("Acme · version 2 · Instagram 4:5");
    expect(en).toContain("## Slide 1 · Text");
    expect(en).toContain("## Caption");
    const italian = slidesMarkdown(pkg, slides as never, meta, texts, "it");
    expect(italian).toContain("Acme · versione 2");
    expect(italian).toContain("## Didascalia");
    expect(italian).not.toContain("## Caption");
  });
});
