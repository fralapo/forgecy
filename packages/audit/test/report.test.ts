import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCarouselSchema, parseManifest, type TemplateManifest } from "@forgecy/carousel";
import type { ReportSection } from "@forgecy/core";
import { describe, expect, it } from "vitest";
import { sectionsToWrite } from "../src/handlers/report";
import { reportSlides } from "../src/report/slides";
import { fitText } from "../src/report/text";
import type { ReportDocItem, ReportDocument } from "../src/service/reports";

const manifestPath = fileURLToPath(
  new URL("../../../templates/reports/report-audit-a4/template.json", import.meta.url),
);
const parsed = parseManifest(readFileSync(manifestPath, "utf8"));
if (!parsed.ok) throw new Error("Invalid report template.json");
const template: TemplateManifest = parsed.manifest;

const long = (n: number) => "word ".repeat(n).trim();
const item = (i: number, extra: Partial<ReportDocItem> = {}): ReportDocItem => ({
  id: `f${i}`,
  kind: "observation",
  title: `Observation ${i}: ${long(30)}`,
  description: long(120),
  impact: null,
  recommendation: null,
  priority: "high",
  evidence: [],
  causes: [],
  ...extra,
});

function doc(sections: ReportDocument["sections"]): ReportDocument {
  return {
    // Italian report on purpose: the assertions below check the Italian text table.
    language: "it",
    agency: { name: "Example Agency" },
    prospect: { name: "Forno Rossi", websiteUrl: "https://forno.example" },
    version: 2,
    status: "approved",
    variant: "full",
    date: "2026-10-06",
    sections,
  };
}

const section = (
  key: ReportDocument["sections"][number]["key"],
  items: ReportDocItem[] = [],
  bullets: string[] = [],
) => ({ key, title: `Section ${key}`, intro: long(100), bullets, note: "", items });

describe("report pages", () => {
  it("fits texts at a word with an ellipsis and drops highlight markers", () => {
    expect(fitText("one two six seven", 12)).toBe("one two six…");
    expect(fitText("now ==short==", 40)).toBe("now =short=");
    expect([...fitText(long(100), 90)].length).toBeLessThanOrEqual(90);
  });

  it("builds pages that pass the template schema, whatever the text length", () => {
    const d = doc([
      section("cover"),
      section("overview", [], [long(40), long(40)]),
      section("problems", [
        item(1, { kind: "problem", impact: long(60), causes: [long(30), "Short"] }),
        item(2, { kind: "problem", description: null, recommendation: "Redo the home page" }),
      ]),
      section("website", [item(3, { evidence: ["Home", "Contact"], recommendation: long(80) })]),
      section("next_steps"),
      section("method", [], [long(30), "Website: read on 2026-10-01"]),
    ]);
    const { slides, dropped } = reportSlides(d, template);
    expect(dropped).toBe(0);
    expect(slides.map((s) => s.layout)).toEqual([
      "cover",
      "section",
      "section",
      "problem",
      "problem",
      "section",
      "finding",
      "next-steps",
      "method",
    ]);
    const check = buildCarouselSchema(template).safeParse(slides);
    expect(check.success ? [] : check.error.issues).toEqual([]);
    expect(slides[0]!.slots).toMatchObject({
      title: "La comunicazione di ==Forno Rossi==",
      client: "Forno Rossi",
      date: "ottobre 2026",
      prepared_by: "Example Agency",
    });
    // A finding without evidence or recommendation still fills the required slots.
    expect(slides[6]!.slots).toMatchObject({
      severity: "Priorità alta",
      evidence: "Home · Contact",
    });
    expect(slides[7]!.slots?.steps).toEqual([
      "Fissiamo una call per decidere insieme le priorità.",
    ]);
  });

  it("builds the Strategy Presentation with brand and pillar pages", () => {
    const d = {
      ...doc([
        section("cover"),
        section("problems", [item(1, { kind: "problem" })]),
        section("brand_identity", [], ["Posizionamento: " + long(60), "Voce: calda"]),
        section(
          "content_strategy",
          [item(2, { title: "Ricette", causes: ["Carbonara", "Amatriciana"], impact: "Prenota" })],
          ["Ricette"],
        ),
        section("next_steps"),
        section("method", [], ["x"]),
      ]),
      variant: "strategy" as const,
    };
    const { slides } = reportSlides(d, template);
    expect(slides.map((s) => s.layout)).toEqual([
      "cover",
      "section",
      "problem",
      "section",
      "section",
      "problem",
      "next-steps",
      "method",
    ]);
    expect(buildCarouselSchema(template).safeParse(slides).success).toBe(true);
    expect(slides[0]!.slots).toMatchObject({
      kicker: "Presentazione della strategia",
      title: "Una strategia per ==Forno Rossi==",
    });
    expect(slides[3]!.slots?.items).toEqual([
      expect.stringMatching(/^Posizionamento/),
      "Voce: calda",
    ]);
    expect(slides[5]!.slots).toMatchObject({
      label: "Pilastro 1",
      title: "Ricette",
      causes: ["Carbonara", "Amatriciana"],
    });
  });

  it("stays within the page limit by dropping findings of the longest section", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(i));
    const { slides, dropped } = reportSlides(
      doc([section("cover"), section("social", many), section("method", [], ["x"])]),
      template,
    );
    expect(slides).toHaveLength(template.slides.max);
    expect(dropped).toBe(60 + 3 - template.slides.max);
    expect(buildCarouselSchema(template).safeParse(slides).success).toBe(true);
  });
});

describe("report texts", () => {
  const s = (key: ReportSection["key"], byAgent?: boolean, enabled = true): ReportSection => ({
    key,
    enabled,
    title: key,
    intro: "",
    bullets: [],
    ...(byAgent === undefined ? {} : { byAgent }),
  });

  it("rewrites only sections not edited by hand, unless asked", () => {
    const sections = [
      s("cover"),
      s("overview", true),
      s("website", false),
      s("social", undefined, false),
      s("next_steps"),
      s("method"),
    ];
    expect(sectionsToWrite(sections, undefined)).toEqual(["overview", "next_steps"]);
    expect(sectionsToWrite(sections, ["website", "cover"])).toEqual(["website"]);
  });
});
