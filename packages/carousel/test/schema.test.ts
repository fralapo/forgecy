import { describe, expect, it } from "vitest";
import { exportFileNames, slugify } from "../src/filenames";
import {
  buildCarouselSchema,
  buildSlideSchema,
  longTextSlide,
  sampleSlide,
  visibleLength,
} from "../src/slide-schema";
import { loadRepoTemplate } from "./helpers";

describe("slide schemas from template.json", async () => {
  const pkg = await loadRepoTemplate("editoriale-ig-4x5");
  const m = pkg.manifest;
  const byId = (id: string) => sampleSlide(m.layouts.find((l) => l.id === id)!);

  it("validates samples and rejects text over the limit", () => {
    const one = buildSlideSchema(m);
    for (const l of m.layouts) expect(one.safeParse(sampleSlide(l)).success, l.id).toBe(true);
    for (const l of m.layouts) expect(one.safeParse(longTextSlide(l)).success, l.id).toBe(true);
    const tooLong = { ...byId("text"), slots: { ...byId("text").slots, title: "x".repeat(61) } };
    const res = one.safeParse(tooLong);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe("«Titolo»: 61 caratteri su 60");
    expect(one.safeParse({ ...byId("text"), layout: "inventato" }).success).toBe(false);
    expect(
      one.safeParse({ ...byId("text"), slots: { ...byId("text").slots, nuovo: "x" } }).success,
    ).toBe(false);
  });

  it("counts characters without highlight markers", () => {
    expect(visibleLength("a ==bc== d")).toBe(6);
    expect(visibleLength("perché")).toBe(6);
  });

  it("enforces slide count, cover first and CTA last", () => {
    const all = buildCarouselSchema(m);
    const good = [byId("cover"), byId("text"), byId("list"), byId("data"), byId("cta")];
    expect(all.safeParse(good).success).toBe(true);
    expect(all.safeParse(good.slice(0, 3)).error?.issues[0]?.message).toContain("da 5 a 10 slide");
    const ctaFirst = [byId("cta"), byId("text"), byId("list"), byId("data"), byId("cover")];
    const msgs = all.safeParse(ctaFirst).error?.issues.map((i) => i.message) ?? [];
    expect(msgs).toContain("Copertina: solo come prima slide");
    expect(msgs).toContain("CTA: solo come ultima slide");
  });
});

describe("export file names", () => {
  it("are deterministic slugs", () => {
    expect(slugify("Rossi S.r.l.")).toBe("rossi-srl");
    expect(slugify("Fattura elettronica: perché?")).toBe("fattura-elettronica-perche");
    const n = exportFileNames({
      client: "Rossi S.r.l.",
      content: "Fattura elettronica",
      version: 3,
      format: "ig_4x5",
      slides: 7,
    });
    expect(n.png[0]).toBe("rossi-srl_fattura-elettronica_v3_ig-4x5_01.png");
    expect(n.png[6]).toBe("rossi-srl_fattura-elettronica_v3_ig-4x5_07.png");
    expect(n.pdf).toBe("rossi-srl_fattura-elettronica_v3_ig-4x5.pdf");
    expect(n.zip).toBe("rossi-srl_fattura-elettronica_v3_ig-4x5.zip");
    const d = exportFileNames({
      client: "Rossi",
      content: "X",
      version: 1,
      format: "linkedin_doc",
      slides: 2,
      draft: true,
    });
    expect(d.png[1]).toBe("rossi_x_v1_linkedin-doc_02_bozza.png");
    expect(d.pdf).toBe("rossi_x_v1_linkedin-doc_bozza.pdf");
  });
});

describe("Docker worker image", () => {
  it("uses the Playwright image matching playwright-core", async () => {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    const dockerfile = await readFile(
      new URL("../../../docker/Dockerfile", import.meta.url),
      "utf8",
    );
    const version = pkg.dependencies["playwright-core"];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dockerfile).toContain(`mcr.microsoft.com/playwright:v${version}-noble AS worker`);
  });
});
