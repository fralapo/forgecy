import { readFileSync } from "node:fs";
import path from "node:path";
import { templateManifestSchema } from "@forgecy/carousel";
import { describe, expect, it } from "vitest";
import {
  CAPTION_RULES,
  CHANNEL_METRICS,
  OUTLINE_SYSTEM,
  SLIDES_SYSTEM,
  SLIDE_COPY_RULES,
  PLANNER_SYSTEM,
  briefBlock,
  outlineOutputSchema,
  slideCountHint,
  type CarouselPromptInput,
} from "../src/ai/prompts";
import { computeChecks } from "../src/carousels/checks";
import { briefSchema, carouselDocumentSchema, outlineSchema } from "../src/document";

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

describe("brief schema additions", () => {
  it("defaults every new field so an old brief still validates", () => {
    const b = briefSchema.parse({ text: "old brief" });
    expect(b).toMatchObject({
      thesis: "",
      emotion: null,
      action: null,
      trigger: "",
      closing: null,
      canSay: [],
      cannotSay: [],
      risk: "",
      openQuestions: [],
      firstComment: "",
      hookArchetype: null,
      hookRationale: "",
      objective: null,
    });
  });

  it("accepts the new fields and rejects values outside the enums", () => {
    const ok = briefSchema.parse({
      emotion: "fear_of_missing_out",
      action: "save",
      closing: "conclusion",
      objective: "tool",
      hookArchetype: "bare_number",
      canSay: [{ text: "Ships in 2 days" }],
      cannotSay: [{ text: "cure" }],
      openQuestions: [{ text: "Is the price final?" }],
    });
    expect(ok.canSay[0]).toEqual({ text: "Ships in 2 days", source: "" });
    expect(ok.cannotSay[0]).toEqual({ text: "cure", reason: "" });
    expect(ok.openQuestions[0]).toEqual({ text: "Is the price final?", resolved: false });
    expect(briefSchema.safeParse({ emotion: "joy" }).success).toBe(false);
    expect(briefSchema.safeParse({ objective: "poster" }).success).toBe(false);
  });
});

describe("outline schema additions", () => {
  it("reads hook alternatives stored as plain strings", () => {
    const o = outlineSchema.parse({
      hookAlternatives: ["Old style", { text: "New", archetype: "common_belief" }],
      rows: [{ id: "a", role: "cover", layout: "cover", point: "x" }],
    });
    expect(o.hookAlternatives).toEqual([
      { text: "Old style" },
      { text: "New", archetype: "common_belief" },
    ]);
    expect(o.needsInput).toBeUndefined();
    expect(outlineSchema.parse({ ...o, needsInput: "payoff" }).needsInput).toBe("payoff");
  });

  it("lets the Copywriter ask for the payoff instead of inventing one", () => {
    const out = outlineOutputSchema.shape.needsInput;
    expect(out.safeParse("payoff").success).toBe(true);
    expect(out.safeParse("").success).toBe(true);
    expect(out.safeParse("price").success).toBe(false);
  });
});

describe("brief checks", () => {
  const cover = { id: "s1", layout: "cover", slots: { title: "A safe cover" } };
  const cta = { id: "s2", layout: "cta", slots: { title: "Write to us", action: "Contact us" } };
  const run = (extra: Parameters<typeof computeChecks>[0]["brief"], caption = "Plain caption") =>
    computeChecks({
      document: carouselDocumentSchema.parse({ title: "T", slides: [cover, cta], caption }),
      manifest,
      channel: "instagram",
      brief: extra,
    });

  it("blocks the export while a question is open", () => {
    const open = run({ openQuestions: [{ text: "q", resolved: false }] });
    const c = open.find((x) => x.id === "brief:open-questions");
    expect(c?.severity).toBe("error");
    expect(
      run({ openQuestions: [{ text: "q", resolved: true }] }).some(
        (x) => x.id === "brief:open-questions",
      ),
    ).toBe(false);
    expect(run(undefined).some((x) => x.id.startsWith("brief:"))).toBe(false);
  });

  it("flags forbidden phrases in slides and caption, ignoring case", () => {
    const found = run({ cannotSay: [{ text: "SAFE cover" }, { text: "plain   caption" }] }).filter(
      (x) => x.id.startsWith("brief:cannot-say:"),
    );
    expect(found.map((x) => x.severity)).toEqual(["error", "error"]);
    expect(found.some((x) => x.slideId === "s1")).toBe(true);
    expect(found.some((x) => !x.slideId)).toBe(true);
    expect(
      run({ cannotSay: [{ text: "absent phrase" }] }).some((x) => x.id.includes("cannot")),
    ).toBe(false);
  });
});

describe("content prompts", () => {
  const brief = briefSchema.parse({
    text: "A brief that is long enough to start",
    thesis: "Cold chain matters",
    emotion: "relief",
    objective: "alert",
    cannotSay: [{ text: "miracle", reason: "claim" }],
    openQuestions: [
      { text: "Is the date final?", resolved: false },
      { text: "Done one", resolved: true },
    ],
    hookArchetype: "nobody_explains",
  });
  const input = {
    title: "T",
    objective: "awareness",
    channel: "instagram",
    language: "en",
    slideCount: 5,
    audience: [],
    pillar: null,
    rubric: null,
    product: null,
    brief,
    manifest,
  } as unknown as CarouselPromptInput;

  it("carries the hook, 3-yes, shareability and arc rules in the outline prompt", () => {
    expect(OUTLINE_SYSTEM).toContain("open loop");
    expect(OUTLINE_SYSTEM).toContain('Never "N tips for X"');
    expect(OUTLINE_SYSTEM).toContain("nobody_explains");
    expect(OUTLINE_SYSTEM).toContain('set "needsInput" to "payoff"');
    expect(OUTLINE_SYSTEM).toContain("Shareability test");
    expect(OUTLINE_SYSTEM).toContain("slide 2 is a second hook");
    expect(OUTLINE_SYSTEM).toContain("penultimate");
    expect(OUTLINE_SYSTEM).toContain("breather");
  });

  it("carries the slide copy and caption rules in the slides prompt", () => {
    for (const rule of [
      "at most 10 words",
      "at most 30",
      "questions the reader would ask",
      "bridge phrase",
      "Tradotto:",
      "source line",
      "Grandma rule",
      "one emotion",
    ])
      expect(SLIDE_COPY_RULES.toLowerCase()).toContain(rule.toLowerCase());
    expect(SLIDES_SYSTEM).toContain(SLIDE_COPY_RULES);
    for (const rule of [
      "line 1 is the cover hook",
      "exactly 3",
      "before the hashtags",
      "4:5",
      "210",
    ])
      expect(CAPTION_RULES).toContain(rule);
    expect(SLIDES_SYSTEM).toContain(CAPTION_RULES);
  });

  it("gives the planner the channel gate metric", () => {
    expect(CHANNEL_METRICS).toContain("saves and shares");
    expect(PLANNER_SYSTEM).toContain(CHANNEL_METRICS);
  });

  it("writes the structured brief and the slide count hint into the brief block", () => {
    const text = briefBlock(input);
    expect(text).toContain("Thesis");
    expect(text).toContain("Cold chain matters");
    expect(text).toContain("relief");
    expect(text).toContain("miracle (claim)");
    expect(text).toContain("Is the date final?");
    expect(text).not.toContain("Done one");
    expect(text).toContain("3 to 5 slides");
    expect(text).toContain("nobody_explains");
  });

  it("gives a hint per objective and none without one", () => {
    expect(slideCountHint("explainer")).toContain("6 to 8");
    expect(slideCountHint("tool")).toContain("8 to 10");
    expect(slideCountHint("document")).toContain("8 to 12");
    expect(slideCountHint(null)).toBeNull();
  });
});
