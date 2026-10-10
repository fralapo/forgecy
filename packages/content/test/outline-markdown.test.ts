import { describe, expect, it } from "vitest";
import { outlineSchema } from "../src/document";
import { hookAlternativesOf } from "../src/ai/pipeline";
import { outlineFromMarkdown, outlineToMarkdown } from "../src/outline-markdown";

const layouts = ["cover", "text", "cta"];
const roles = ["cover", "text", "cta"];

const sample = outlineSchema.parse({
  title: "Choosing a CRM",
  hook: "Is your CRM costing you deals?",
  hookAlternatives: ["3 fields are enough", "Why do leads go cold?"],
  cta: "Book a demo",
  rows: [
    { id: "a", role: "cover", layout: "cover", point: "Hook slide" },
    { id: "b", role: "text", layout: "text", point: "Line one\nline two", note: "use a chart" },
    { id: "c", role: "cta", layout: "cta", point: "Ask for the demo" },
  ],
});

describe("outline markdown", () => {
  it("round-trips an outline", () => {
    const r = outlineFromMarkdown(outlineToMarkdown(sample), layouts, roles);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const strip = (o: typeof sample) => ({
      ...o,
      rows: o.rows.map(({ id: _id, edited: _e, ...x }) => x),
    });
    expect(strip(r.outline)).toEqual(strip(sample));
    expect(r.outline.rows.every((x) => x.edited && x.id)).toBe(true);
  });

  it("accepts an outline stored before alternatives existed", () => {
    const old = outlineSchema.parse({
      rows: [{ id: "a", role: "cover", layout: "cover", point: "x" }],
    });
    expect(old.hookAlternatives).toEqual([]);
    expect(outlineFromMarkdown(outlineToMarkdown(old), layouts, roles).ok).toBe(true);
  });

  it("reports typed errors", () => {
    const md = "# T\nstray\n## 1. banana | cover\nx\n## 2. text | nope\ny\n";
    const r = outlineFromMarkdown(md, layouts, roles);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      { code: "unexpectedLine", line: 2 },
      { code: "unknownRole", line: 3, value: "banana" },
      { code: "unknownLayout", line: 5, value: "nope" },
    ]);
  });

  it("rejects no slides, too many alternatives and over-long fields", () => {
    expect(outlineFromMarkdown("# T\nHook: h\n", layouts, roles)).toEqual({
      ok: false,
      errors: [{ code: "noSlides" }],
    });
    const three = "Alt hook: a\nAlt hook: b\nAlt hook: c\n## 1. cover | cover\np\n";
    expect(outlineFromMarkdown(three, layouts, roles)).toMatchObject({
      ok: false,
      errors: [{ code: "tooManyAltHooks" }],
    });
    const long = `## 1. cover | cover\n${"x".repeat(281)}\n`;
    expect(outlineFromMarkdown(long, layouts, roles)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid", value: "rows.0.point" }],
    });
  });
});

describe("hookAlternativesOf", () => {
  it("drops blanks, the hook itself and repeats, keeps two", () => {
    expect(hookAlternativesOf("H", [" H ", "", "A", "A", "B", "C"])).toEqual(["A", "B"]);
  });
});
