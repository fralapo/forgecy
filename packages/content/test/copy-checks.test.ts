import { readFileSync } from "node:fs";
import path from "node:path";
import { templateManifestSchema } from "@forgecy/carousel";
import { describe, expect, it } from "vitest";
import { computeChecks, type CheckInput } from "../src/carousels/checks";
import { carouselDocumentSchema } from "../src/document";

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
const tags = ["a", "b", "c"];
const text = (id: string, body = "Breve.") => ({
  id,
  layout: "text",
  slots: { title: "Punto", body },
});
const cover = { id: "s1", layout: "cover", slots: { title: "Come scegliere" } };
const cta = { id: "s9", layout: "cta", slots: { title: "Scrivici", action: "Contattaci" } };
/** Cover, the given middle slides (padded to the template minimum) and the call to action. */
const deck = (...mid: unknown[]) => [
  cover,
  ...mid,
  ...[text("p1"), text("p2"), text("p3")].slice(0, Math.max(0, 3 - mid.length)),
  cta,
];
const run = (
  slides: unknown[],
  extra: Record<string, unknown> = {},
  input: Partial<CheckInput> = {},
) =>
  computeChecks({
    document: carouselDocumentSchema.parse({ title: "T", slides, hashtags: tags, ...extra }),
    manifest,
    channel: "instagram",
    ...input,
  });
const ids = (c: ReturnType<typeof run>) => c.map((x) => x.id);

describe("copy checks", () => {
  it("makes a placeholder in a slide or the caption an error", () => {
    const c = run(deck(text("s2", "Prezzo [da confermare]")), { caption: "TODO caption" });
    expect(c.filter((x) => x.id.startsWith("placeholder:")).map((x) => [x.id, x.severity])).toEqual(
      [
        ["placeholder:s2", "error"],
        ["placeholder:caption", "error"],
      ],
    );
    expect(run(deck(text("s2")))).toEqual([]);
  });

  it("warns on AI tells per language, never on a language without patterns", () => {
    const slides = deck(text("s2", "Non è solo un tool, è un metodo."));
    const c = run(slides, {}, { language: "it" });
    expect(c.find((x) => x.id === "aitell:contrast:s2")?.severity).toBe("warning");
    expect(ids(run(slides, {}, { language: "de" }))).not.toContain("aitell:contrast:s2");
    expect(ids(run(slides))).not.toContain("aitell:contrast:s2");
    const en = run(
      deck(text("s2", "It's not just a tool, it's a method.")),
      {},
      { language: "en" },
    );
    expect(ids(en)).toContain("aitell:contrast:s2");
  });

  it("wants exactly three hashtags on Instagram only", () => {
    const slides = deck(text("s2"));
    expect(ids(run(slides, { hashtags: ["a", "b"] }))).toContain("caption:hashtags");
    expect(ids(run(slides, { hashtags: [...tags, "d"] }))).toContain("caption:hashtags");
    expect(ids(run(slides, { hashtags: [] }, { channel: "linkedin" }))).not.toContain(
      "caption:hashtags",
    );
  });

  it("asks for the credit line before the hashtags when credits exist", () => {
    const credits = ["Foto: Anna R."];
    const slides = deck(text("s2"));
    const id = "caption:credit:foto: anna r.";
    expect(ids(run(slides, { caption: "Ciao" }, { credits }))).toContain(id);
    expect(ids(run(slides, { caption: "Ciao\nFoto: Anna R." }, { credits }))).not.toContain(id);
  });

  it("warns on four dense body slides in a row, not on three", () => {
    const dense = (id: string) => text(id, "parola ".repeat(40).trim());
    expect(ids(run(deck(dense("a"), dense("b"), dense("c"))))).not.toContain("rhythm:a");
    const c = run(deck(dense("a"), dense("b"), dense("c"), dense("d")));
    expect(c.find((x) => x.id === "rhythm:a")?.severity).toBe("warning");
  });

  it("warns once on five slides in a row with the same tone, only when tone varies", () => {
    const toned = (id: string, tone: string) => ({ ...text(id), tone });
    const toneIds = (slides: unknown[]) => ids(run(slides)).filter((i) => i.startsWith("rhythm:tone"));
    const same = ["a", "b", "c", "d", "e"].map((id) => toned(id, "default"));
    expect(toneIds(deck(...same))).toEqual([]);
    const mixed = [...same, toned("f", "inverse")];
    expect(toneIds(deck(...mixed))).toEqual(["rhythm:tone:s1"]);
    const paced = ["a", "b", "c", "d"].map((id, n) => toned(id, n === 2 ? "accent" : "default"));
    expect(toneIds(deck(...paced))).toEqual([]);
  });

  it("checks tu/voi against the brand writing rules", () => {
    const slides = deck(text("s2", "Se volete, potete provare."));
    expect(ids(run(slides, {}, { language: "it", person: "tu" }))).toContain("person:s2");
    expect(ids(run(slides, {}, { language: "it", person: "voi" }))).not.toContain("person:s2");
    expect(ids(run(slides, {}, { language: "it", person: "noi" }))).not.toContain("person:s2");
    expect(ids(run(slides, {}, { language: "it" }))).not.toContain("person:s2");
  });

  it("checks you/we in English against the brand writing rules", () => {
    const slides = deck(text("s2", "You can try it today."));
    expect(ids(run(slides, {}, { language: "en", person: "noi" }))).toContain("voice:s2");
    expect(ids(run(slides, {}, { language: "en", person: "tu" }))).not.toContain("voice:s2");
    expect(ids(run(slides, {}, { language: "en", person: "impersonale" }))).not.toContain(
      "voice:s2",
    );
    expect(ids(run(slides, {}, { language: "en" }))).not.toContain("voice:s2");
    const mixed = deck(text("s2", "We help you try it."));
    expect(ids(run(mixed, {}, { language: "en", person: "noi" }))).not.toContain("voice:s2");
    expect(ids(run(slides, {}, { language: "it", person: "noi" }))).not.toContain("voice:s2");
  });
});
