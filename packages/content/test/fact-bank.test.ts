import { readFileSync } from "node:fs";
import path from "node:path";
import { templateManifestSchema } from "@forgecy/carousel";
import { describe, expect, it } from "vitest";
import { computeChecks } from "../src/carousels/checks";
import { factBankOf, factBankPrompt, factInCopy } from "../src/carousels/facts";
import { carouselDocumentSchema } from "../src/document";
import { claimsUserPrompt } from "../src/ai/prompts";
import type { ProductFactRef } from "../src/products";

const manifest = templateManifestSchema.parse(
  JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../templates/carousels/editorial-ig-4x5/template.json",
      ),
      "utf8",
    ),
  ),
);
const text = (id: string, body: string) => ({
  id,
  layout: "text",
  slots: { title: "Punto", body },
});
const slides = (body: string) => [
  { id: "s1", layout: "cover", slots: { title: "Come scegliere" } },
  text("s2", body),
  text("p1", "Breve."),
  text("p2", "Breve."),
  { id: "s9", layout: "cta", slots: { title: "Scrivici", action: "Contattaci" } },
];
const run = (body: string, caption: string, extra: Parameters<typeof computeChecks>[0]["facts"]) =>
  computeChecks({
    document: carouselDocumentSchema.parse({
      title: "T",
      slides: slides(body),
      caption,
      hashtags: ["a", "b", "c"],
    }),
    manifest,
    channel: "instagram",
    ...(extra ? { facts: extra } : {}),
  });

const fact = (
  textValue: string,
  status: ProductFactRef["status"],
  keywords: string[] = [],
): ProductFactRef => ({ text: textValue, keywords, status });

describe("factInCopy", () => {
  it("matches the text across spacing and case, and keywords as whole words", () => {
    const f = fact("Senza glutine", "do_not_use", ["celiaci"]);
    expect(factInCopy("Un prodotto  SENZA\nglutine, davvero", f)).toBe(true);
    expect(factInCopy("Pensato per i celiaci.", f)).toBe(true);
    expect(factInCopy("Pensato per i celiacia.", f)).toBe(false);
    expect(factInCopy("Niente di tutto questo", f)).toBe(false);
  });
});

describe("factBankOf", () => {
  const product = {
    highlights: ["Acciaio inox"],
    facts: [
      fact("Stampato sul retro", "printed_on_pack"),
      fact("Solo catalogo", "catalog_only"),
      fact("Da chiedere", "pending_client"),
      fact("Vietato", "do_not_use"),
    ],
  };
  it("keeps highlights and usable facts as the verified bank", () => {
    const bank = factBankOf(product);
    expect(bank.usable).toEqual(["Acciaio inox", "Stampato sul retro", "Solo catalogo"]);
    expect(bank.pending.map((f) => f.text)).toEqual(["Da chiedere"]);
    expect(bank.doNotUse.map((f) => f.text)).toEqual(["Vietato"]);
  });
  it("is empty without a product", () => {
    expect(factBankOf(null)).toEqual({ usable: [], doNotUse: [], pending: [] });
    expect(factBankPrompt(factBankOf(null))).toBe("");
  });
  it("tells the claim critic what is verified and what is off limits", () => {
    const prompt = factBankPrompt(factBankOf(product));
    expect(prompt).toContain("- Acciaio inox");
    expect(prompt).toContain("- Vietato");
    expect(prompt).not.toContain("Da chiedere");
    const user = claimsUserPrompt({
      brief: "Brief",
      factBank: prompt,
      document: carouselDocumentSchema.parse({ title: "T", slides: slides("x") }),
      language: "it",
    });
    expect(user.indexOf("Verified fact bank")).toBeGreaterThan(user.indexOf("Brief"));
  });
});

describe("fact checks", () => {
  const facts = {
    doNotUse: [fact("cura il mal di schiena", "do_not_use")],
    pending: [fact("certificato bio", "pending_client", ["bio"])],
  };
  it("makes a do_not_use fact in a slide or the caption an error", () => {
    const c = run("Questo cuscino cura il mal di schiena.", "Cura il mal di schiena!", facts);
    const hits = c.filter((x) => x.id.startsWith("facts:do-not-use:"));
    expect(hits.map((x) => [x.severity, x.slideId ?? "caption"])).toEqual([
      ["error", "s2"],
      ["error", "caption"],
    ]);
    expect(hits[0]!.message).toContain("cura il mal di schiena");
  });
  it("warns on a pending_client fact", () => {
    const c = run("Il tessuto è bio.", "", facts);
    expect(c.find((x) => x.id.startsWith("facts:pending:"))?.severity).toBe("warning");
    expect(c.some((x) => x.id.startsWith("facts:do-not-use:"))).toBe(false);
  });
  it("stays quiet without a fact in the copy or without a bank", () => {
    expect(run("Tutto a posto.", "Ciao", facts).some((x) => x.id.startsWith("facts:"))).toBe(false);
    expect(
      run("Cura il mal di schiena", "", undefined).some((x) => x.id.startsWith("facts:")),
    ).toBe(false);
  });
});

describe("stock credits", () => {
  it("asks for the credit line before the hashtags when credits are given", () => {
    const c = computeChecks({
      document: carouselDocumentSchema.parse({
        title: "T",
        slides: slides("Breve."),
        caption: "Una didascalia.",
        hashtags: ["a", "b", "c"],
      }),
      manifest,
      channel: "instagram",
      credits: ["Foto: Mario Rossi / Unsplash"],
    });
    expect(c.find((x) => x.id.startsWith("caption:credit:"))?.severity).toBe("warning");
  });
});
