import { describe, expect, it } from "vitest";
import { checkContent, contrastThreshold, extractFacts } from "../src/checks";
import type { GuardContent, GuardRender, GuardTextSlot } from "../src/types";
import { brand, content } from "./fixtures";

const now = new Date("2026-10-06T10:00:00Z");
const run = (c: GuardContent, render?: GuardRender) => checkContent(c, brand(), render, { now });
const checks = (c: GuardContent, render?: GuardRender) =>
  run(c, render).findings.map((f) => `${f.check}:${f.severity}`);

function withText(text: string, slide = 1, slot = "title"): GuardContent {
  const c = content();
  const s = c.slides[slide]!.slots.find((x) => x.name === slot) as GuardTextSlot;
  s.text = text;
  s.maxChars = undefined;
  return c;
}

describe("brand check on a clean carousel", () => {
  it("has no findings, a full score and lists the checks it did not run", () => {
    const r = run(content());
    expect(r.findings).toEqual([]);
    expect(r.coherence).toMatchObject({ score: 100, band: "eccellente" });
    expect(r.notRun.map((n) => n.check)).toEqual(["product_fact", "render", "reviewer_judgement"]);
    expect(r).toMatchObject({ brandIdentityVersionNumber: 3, checkedAt: now.toISOString() });
  });

  it("is deterministic: same input, same keys and order", () => {
    const c = withText("Prodotto economico, il migliore!!");
    expect(run(c).findings).toEqual(run(c).findings);
  });
});

describe("editorial rules", () => {
  it("reports text over the slot limit as an error with the spec's wording", () => {
    const c = content();
    (c.slides[0]!.slots[0] as GuardTextSlot).text = "x".repeat(72);
    const f = run(c).findings.find((x) => x.check === "text_length")!;
    expect(f).toMatchObject({ severity: "error", slide: 0, slot: "title", measured: 72 });
    expect(f.message).toBe("Titolo: 72/60 caratteri. Accorcia a 60.");
  });

  it("ignores highlight markers when counting", () => {
    const c = content();
    (c.slides[0]!.slots[0] as GuardTextSlot).text = `==${"x".repeat(60)}==`;
    expect(checks(c)).not.toContain("text_length:error");
  });

  it("warns above 90% of the words per slide of the brand format", () => {
    const c = withText("parola ".repeat(16).trim());
    const f = run(c).findings.find((x) => x.check === "word_density")!;
    expect(f).toMatchObject({ severity: "warning", slide: 1, threshold: 20 });
    expect(f.rule?.path).toBe("/document/content/formats/0/maxWordsPerSlide");
  });

  it("warns on a long hook, a missing CTA and a short structure", () => {
    const c = content();
    (c.slides[0]!.slots[0] as GuardTextSlot).text =
      "uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici";
    c.slides = c.slides.slice(0, 2);
    expect(checks(c)).toEqual(
      expect.arrayContaining(["hook_length:warning", "cta_missing:warning", "structure:note"]),
    );
  });

  it("flags a thumbnail title under 8 px", () => {
    const c = content();
    (c.slides[0]!.slots[0] as GuardTextSlot).fontSizePx = 60;
    const f = run(c).findings.find((x) => x.check === "thumbnail_legibility")!;
    expect(f).toMatchObject({ severity: "warning", measured: 6.8, threshold: 8 });
  });
});

describe("vocabulary and claims", () => {
  it("flags forbidden words as errors with the BI rule", () => {
    const f = run(withText("Un caffè Economico ma buono")).findings.find(
      (x) => x.check === "forbidden_word",
    )!;
    expect(f).toMatchObject({ severity: "error", measured: "Economico" });
    expect(f.rule).toEqual({ path: "/document/verbal/forbiddenWords/0", text: "economico" });
    expect(f.suggestion).toContain("accessibile");
    // Whole words only.
    expect(checks(withText("Antieconomico"))).not.toContain("forbidden_word:error");
  });

  it("checks spellings, keeping a capital at sentence start", () => {
    expect(checks(withText("Vendi con ecommerce"))).toContain("spelling:warning");
    expect(checks(withText("E commerce facile"))).toContain("spelling:warning");
    expect(checks(withText("E-commerce facile"))).not.toContain("spelling:warning");
  });

  it("applies the writing rules", () => {
    expect(checks(withText("Buono ☕"))).toContain("emoji:warning");
    expect(checks(withText("Wow!"))).not.toContain("exclamation:note");
    expect(checks(withText("Wow! Sì!"))).toContain("exclamation:note");
    expect(
      checks(
        withText("uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici"),
      ),
    ).toContain("sentence_length:warning");
    const c = content();
    c.caption = "#uno #due #tre #quattro";
    expect(checks(c)).toContain("hashtags:warning");
  });

  it("flags literal mentions of topics to avoid", () => {
    expect(checks(withText("Niente politica"))).toContain("avoid_topic:warning");
  });

  it("warns on sensitive claims unless they repeat a proven message", () => {
    const f = run(withText("Garantito al 100%")).findings.filter(
      (x) => x.check === "sensitive_claim",
    );
    expect(f.map((x) => x.measured).sort()).toEqual(["100%", "Garantito"]);
    expect(checks(withText("Il miglior caffè per l'ufficio"))).not.toContain(
      "sensitive_claim:warning",
    );
    expect(checks(withText("Il migliore della città"))).toContain("sensitive_claim:warning");
  });
});

describe("product facts", () => {
  const withProduct = (text: string, asksPrice?: boolean) => {
    const c = withText(text);
    c.product = {
      name: "Moka X200",
      facts: ["Capacità: 6 tazze", "Garanzia 2 anni", "Alluminio, 0,5 l"],
      price: "€ 39,90",
    };
    if (asksPrice !== undefined) c.brief = { asksPrice };
    return c;
  };

  it("reads numbers and units the Italian way", () => {
    expect(extractFacts("Garanzia 5 anni, 1.200 W, € 39,90, 0,5 l")).toEqual([
      { raw: "5 anni", value: 5, unit: "anni" },
      { raw: "1.200 W", value: 1200, unit: "w" },
      { raw: "39,90 €", value: 39.9, unit: "€" },
      { raw: "0,5 l", value: 0.5, unit: "l" },
    ]);
  });

  it("errors on facts missing from the approved product", () => {
    const f = run(withProduct("Garanzia 5 anni")).findings.find((x) => x.check === "product_fact")!;
    expect(f.message).toBe("Slide 2 · Titolo: «5 anni» non è nella scheda di «Moka X200».");
    expect(checks(withProduct("Garanzia 2 anni, 0.5 l"))).not.toContain("product_fact:error");
  });

  it("allows a price only when the product has it and the brief asks for it", () => {
    expect(checks(withProduct("Solo 39,90 euro"))).toContain("price_not_requested:error");
    expect(checks(withProduct("Solo 39,90 euro", true))).not.toContain("price_not_requested:error");
    expect(checks(withProduct("Solo € 29", true))).toContain("product_fact:error");
  });
});

describe("visual rules", () => {
  it("errors on colors and fonts outside the brand, naming the nearest role", () => {
    const c = content();
    const t = c.slides[1]!.slots[0] as GuardTextSlot;
    t.color = { hex: "#3A2012" };
    t.fontFamily = "Comic Sans MS";
    const r = run(c).findings;
    expect(r.find((f) => f.check === "off_brand_color")?.suggestion).toBe(
      "Usa il ruolo «Colore del brand» (#3B1F12).",
    );
    expect(r.find((f) => f.check === "off_brand_font")?.suggestion).toContain("Fraunces");
    t.color = { token: "color.semantic.nope" };
    t.fontFamily = "Arial";
    expect(checks(c)).toEqual(["off_brand_color:error"]);
  });

  it("measures contrast at the size the text is seen", () => {
    expect(contrastThreshold({ fontSizePx: 68 }, 1080)).toBe(3);
    expect(contrastThreshold({ fontSizePx: 54, bold: true }, 1080)).toBe(3);
    expect(contrastThreshold({ fontSizePx: 60 }, 1080)).toBe(4.5);
    expect(contrastThreshold({}, 1080)).toBe(4.5);
    const c = content();
    (c.slides[1]!.slots[1] as { color: unknown }).color = { token: "color.semantic.surface" };
    const f = run(c).findings.find((x) => x.check === "contrast")!;
    expect(f).toMatchObject({ severity: "error", origin: "json", threshold: 4.5 });
    expect(f.suggestion).toMatch(/^Usa il ruolo «/);
  });
});

describe("images", () => {
  it("blocks approval on AI images not approved and warns next to real photos", () => {
    const c = content();
    c.slides[1]!.slots.push(
      {
        kind: "image",
        name: "photo",
        asset: { id: "a1", origin: "ai", approval: "draft", width: 2000, height: 2000 },
        slotWidth: 1080,
        slotHeight: 600,
      },
      {
        kind: "image",
        name: "product",
        asset: { id: "a2", origin: "product", width: 400, height: 400 },
        slotWidth: 1080,
        slotHeight: 600,
      },
    );
    const r = run(c).findings;
    expect(r.find((f) => f.check === "ai_image_unapproved")?.blocksApproval).toBe(true);
    expect(r.find((f) => f.check === "ai_next_to_photo")?.severity).toBe("warning");
    expect(r.find((f) => f.check === "low_resolution")).toMatchObject({
      severity: "error",
      message: "Slide 2 · product: immagine 400×400 px per uno slot di 1080 px.",
    });
  });
});

describe("render measures", () => {
  type Measure = GuardRender["slides"][number]["slots"][number];
  const measure = (name: string, over: Partial<Measure> = {}): Measure => ({
    name,
    kind: "text",
    overflow: false,
    outsideSlide: false,
    outsideSafe: false,
    lines: 1,
    naturalWidth: 0,
    naturalHeight: 0,
    rect: { x: 80, y: 100, width: 900, height: 100 },
    ...over,
  });

  it("turns geometry and pixel contrast into findings", () => {
    const c = content();
    (c.slides[1]!.slots[0] as GuardTextSlot).maxLines = 2;
    const render: GuardRender = {
      slides: [
        {
          slide: 1,
          slots: [
            measure("title", { overflow: true, lines: 3 }),
            measure("items", {
              outsideSafe: true,
              rect: { x: 80, y: 150, width: 900, height: 400 },
            }),
          ],
          contrast: [{ slot: "items", fgHex: "#FFFFFF", bgHex: "#D9C7B0" }],
        },
      ],
    };
    const r = run(c, render);
    expect(r.hasRender).toBe(true);
    expect(
      r.findings
        .filter((f) => f.origin === "render")
        .map((f) => f.check)
        .sort(),
    ).toEqual([
      "contrast_on_render",
      "outside_safe_zone",
      "overlap",
      "text_overflow",
      "too_many_lines",
    ]);
    expect(r.findings.find((f) => f.check === "contrast_on_render")?.message).toBe(
      "Slide 2 · Elenco: contrasto 1,6:1; minimo 4,5:1.",
    );
    expect(r.notRun.map((n) => n.check)).not.toContain("render");
  });

  it("downgrades decorative elements outside the safe zone to a warning", () => {
    const c = content();
    c.slides[1]!.slots[0]!.decorative = true;
    const render: GuardRender = {
      slides: [{ slide: 1, slots: [measure("title", { outsideSafe: true })] }],
    };
    expect(checks(c, render)).toEqual(["outside_safe_zone:warning"]);
  });
});

describe("coherence", () => {
  it("scores from the findings, with evidence per category", () => {
    const r = run(withText("Prodotto economico e low cost"));
    expect(r.counts).toEqual({ error: 2, warning: 0, note: 0 });
    expect(r.coherence).toMatchObject({ score: 70, band: "discreto" });
    const vocab = r.coherence.categories.find((c) => c.category === "vocabulary")!;
    expect(vocab).toMatchObject({ score: 70, evidence: r.findings.map((f) => f.key) });
  });
});
