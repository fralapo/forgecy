import { readFileSync } from "node:fs";
import path from "node:path";
import { createAiGateway, createFakeTextProvider, createMemoryLedger } from "@forgecy/ai";
import { templateManifestSchema } from "@forgecy/carousel";
import { describe, expect, it } from "vitest";
import { adaptProposalOf } from "../src/ai/pipeline";
import {
  ADAPT_CHANNEL_RULES,
  ADAPT_SYSTEM,
  adaptOutputSchema,
  adaptUserPrompt,
  type AdaptOutput,
} from "../src/ai/prompts";
import { adaptedDocument } from "../src/carousels/adapt";
import { clampSlots } from "../src/carousels/templates";
import { adaptProposalSchema, carouselDocumentSchema, gateMetricOf } from "../src/document";

const load = (dir: string) =>
  templateManifestSchema.parse(
    JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, `../../../templates/carousels/${dir}/template.json`),
        "utf8",
      ),
    ),
  );
const linkedin = load("editorial-linkedin");
const facebook = load("editorial-fb-4x5");
const sourceId = crypto.randomUUID();

const slot = (name: string, text: string) => ({ name, text, items: [] as string[] });
const creditable: AdaptOutput = {
  creditableAngle: true,
  angle: "The payoff becomes a procedure a team can adopt.",
  reason: "The proof is a process, which LinkedIn readers apply at work.",
  slides: [
    { layout: "cover", slots: [slot("title", "x".repeat(300)), slot("ghost", "unknown slot")] },
    { layout: "does-not-exist", slots: [slot("title", "Dropped")] },
    { layout: "text", slots: [slot("title", "Step one"), slot("body", "Write it down.")] },
  ],
  caption: "Hook first. @someone and @other say hi.  More text.",
  hashtags: ["safety", "#Safety", "work", "team", "ops", "extra", "more"],
};
const skip: AdaptOutput = {
  creditableAngle: false,
  angle: "",
  reason: "The idea is a scroll-and-save habit with no professional equivalent.",
  slides: [{ layout: "cover", slots: [slot("title", "Should be ignored")] }],
  caption: "ignored",
  hashtags: ["ignored"],
};
const ctx = (channel: "linkedin" | "facebook", manifest = linkedin) => ({
  sourceContentId: sourceId,
  channel,
  templateKey: `editorial-${channel}`,
  manifest,
  draftRev: 3,
});

describe("channel adaptation: schema and prompt", () => {
  it("only LinkedIn and Facebook are adapted to, and a skip carries no slides", () => {
    const proposal = adaptProposalOf(skip, ctx("linkedin"));
    expect(adaptProposalSchema.parse(proposal)).toMatchObject({
      creditableAngle: false,
      slides: [],
      caption: "",
      hashtags: [],
      gateMetric: "dwell_comments",
    });
    expect(adaptProposalSchema.safeParse({ ...proposal, channel: "instagram" }).success).toBe(
      false,
    );
    expect(adaptOutputSchema.shape).not.toHaveProperty("html");
  });

  it("states the skip rule and the channel rules", () => {
    expect(ADAPT_SYSTEM).toContain("creditableAngle=false");
    expect(ADAPT_SYSTEM).toContain("no slides");
    expect(ADAPT_SYSTEM).toContain("No HTML");
    expect(ADAPT_CHANNEL_RULES.linkedin).toContain("210 characters");
    expect(ADAPT_CHANNEL_RULES.linkedin).toContain("3 to 5 sector hashtags");
    expect(ADAPT_CHANNEL_RULES.linkedin).toContain("company procedure");
    expect(ADAPT_CHANNEL_RULES.facebook).toContain("ONE 4:5 frame");
    expect(ADAPT_CHANNEL_RULES.facebook).toContain("0 to 3 hashtags");
    expect(ADAPT_CHANNEL_RULES.facebook).toContain("no @mentions");
    expect(ADAPT_CHANNEL_RULES.facebook).toContain("link is allowed");
    expect(gateMetricOf).toMatchObject({
      instagram: "saves_shares",
      facebook: "group_shares_comments",
      linkedin: "dwell_comments",
    });
  });

  it("the user prompt carries the target rules, the layouts and the source copy", () => {
    const source = carouselDocumentSchema.parse({
      slides: [{ id: "a", layout: "cover", slots: { title: "Cool water" } }],
      caption: "Save this.",
      hashtags: ["#a", "#b", "#c"],
    });
    const prompt = adaptUserPrompt({
      channel: "facebook",
      brief: "Brief text",
      source,
      sourceLayouts: [{ layout: "cover", role: "cover" }],
      layouts: '- layout "cover"',
      maxSlides: 1,
      captionBudget: 3000,
      language: "it",
    });
    expect(prompt).toContain("Target channel: facebook");
    expect(prompt).toContain("Slides: at most 1");
    expect(prompt).toContain("Cool water");
    expect(prompt).toContain('- layout "cover"');
    expect(prompt).toContain("Language of the copy: it");
  });
});

describe("channel adaptation: proposal", () => {
  it("keeps only layouts of the template, cuts slots to them, and respects the channel limits", () => {
    const p = adaptProposalOf(creditable, ctx("linkedin"));
    expect(p.creditableAngle).toBe(true);
    expect(p.slides.map((s) => s.layout)).toEqual(["cover", "text"]);
    const cover = linkedin.layouts.find((l) => l.id === "cover")!;
    const max = cover.slots.find((s) => s.name === "title" && s.type === "text")!;
    const title = p.slides[0]!.slots.title as string;
    expect(title.length).toBeLessThanOrEqual(max.type === "text" ? max.maxChars : 0);
    expect(p.slides[0]!.slots).not.toHaveProperty("ghost");
    expect(p.hashtags).toEqual(["#safety", "#work", "#team", "#ops", "#extra"]);
    expect(p.draftRev).toBe(3);
  });

  it("Facebook is one frame, up to 3 hashtags, no @mentions", () => {
    const p = adaptProposalOf(creditable, ctx("facebook", facebook));
    expect(p.gateMetric).toBe("group_shares_comments");
    expect(p.slides.length).toBeLessThanOrEqual(1);
    expect(p.hashtags.length).toBeLessThanOrEqual(3);
    expect(p.caption).not.toContain("@");
    expect(p.caption).toContain("Hook first.");
  });

  it("a creditable answer with nothing usable becomes a skip", () => {
    const p = adaptProposalOf(
      { ...creditable, slides: [{ layout: "nope", slots: [slot("title", "x")] }] },
      ctx("linkedin"),
    );
    expect(p).toMatchObject({ creditableAngle: false, slides: [], caption: "", angle: "" });
  });

  it("accepting builds a document with the proposed slots clamped to the layouts", () => {
    const p = adaptProposalOf(creditable, ctx("linkedin"));
    // A stored proposal made against an older template: too long text, a list slot and a stray slot.
    const stale = {
      ...p,
      slides: [
        { layout: "cover", slots: { title: "y".repeat(500), nope: "z" } },
        { layout: "gone", slots: { title: "x" } },
        {
          layout: "list",
          slots: { title: "Three", items: Array.from({ length: 12 }, (_, i) => `Item ${i}`) },
        },
      ] as typeof p.slides,
    };
    const doc = adaptedDocument(stale, linkedin, "Source title");
    expect(doc.slides.map((s) => s.layout)).toEqual(["cover", "list"]);
    expect(new Set(doc.slides.map((s) => s.id)).size).toBe(2);
    expect(doc.slides.every((s) => s.tone === "default" && s.protectedSlots.length === 0)).toBe(
      true,
    );
    const cover = linkedin.layouts.find((l) => l.id === "cover")!;
    const t = cover.slots.find((s) => s.name === "title")!;
    expect((doc.slides[0]!.slots.title as string).length).toBeLessThanOrEqual(
      t.type === "text" ? t.maxChars : 0,
    );
    expect(doc.slides[0]!.slots).not.toHaveProperty("nope");
    const list = linkedin.layouts.find((l) => l.id === "list")!;
    const items = list.slots.find((s) => s.type === "list")!;
    expect((doc.slides[1]!.slots.items as string[]).length).toBeLessThanOrEqual(
      items.type === "list" ? items.maxItems : 0,
    );
    expect(doc.title).toBe("Source title");
    expect(doc.hashtags).toEqual(p.hashtags);
    expect(carouselDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("clampSlots drops image slots and cuts on a word", () => {
    const cover = linkedin.layouts.find((l) => l.id === "cover")!;
    const out = clampSlots(cover, { image: "no", kicker: "word ".repeat(30), title: "Fine" });
    expect(out).not.toHaveProperty("image");
    expect(out.title).toBe("Fine");
    expect((out.kicker as string).endsWith("word")).toBe(true);
  });
});

describe("channel adaptation: scripted AI client", () => {
  const run = async (reply: AdaptOutput, channel: "linkedin" | "facebook" = "linkedin") => {
    const fake = createFakeTextProvider("anthropic");
    const ledger = createMemoryLedger();
    const gateway = createAiGateway({
      ledger,
      providers: { text: { anthropic: fake }, image: {} },
      routing: { default: { primary: { provider: "anthropic", model: "fake-model" } } },
    });
    fake.push({ json: reply });
    const res = await gateway.generateObject({
      task: "adapt_channel",
      schema: adaptOutputSchema,
      system: ADAPT_SYSTEM,
      input: "x",
      clientId: crypto.randomUUID(),
      clientPolicy: "external_allowed",
    });
    return {
      proposal: adaptProposalOf(
        res.data,
        ctx(channel, channel === "facebook" ? facebook : linkedin),
      ),
      ledger,
    };
  };

  it("creditableAngle true gives a proposal with slides, logged as adapt_channel", async () => {
    const { proposal, ledger } = await run(creditable);
    expect(proposal.creditableAngle).toBe(true);
    expect(proposal.slides.length).toBeGreaterThan(0);
    expect(ledger.entries.at(-1)).toMatchObject({ kind: "adapt_channel", status: "ok" });
  });

  it("creditableAngle false gives a skip with the reason and no slides", async () => {
    const { proposal } = await run(skip, "facebook");
    expect(proposal).toMatchObject({
      creditableAngle: false,
      slides: [],
      reason: skip.reason,
      gateMetric: "group_shares_comments",
    });
  });
});
