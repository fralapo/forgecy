import { describe, expect, it } from "vitest";
import { visualNotesOf } from "../src/ai/pipeline";
import {
  VISUAL_CHECKS,
  VISUAL_SYSTEM,
  visualNotesOutputSchema,
  visualUserPrompt,
} from "../src/ai/prompts";
import { carouselDocumentSchema } from "../src/document";

const doc = carouselDocumentSchema.parse({
  slides: [
    { id: "a", layout: "cover", slots: { title: "Cool water" } },
    { id: "b", layout: "text", slots: { title: "Why", body: "Because." } },
  ],
});

describe("visual reviewer", () => {
  it("checks the 11 points and asks for notes only, never a score or praise", () => {
    expect(VISUAL_CHECKS).toHaveLength(11);
    expect(VISUAL_SYSTEM).toContain("stranger scrolling Instagram");
    expect(VISUAL_SYSTEM).toContain("No score");
    expect(visualNotesOutputSchema.shape).not.toHaveProperty("score");
  });

  it("keeps the notes of slides that exist, once each, with the slide id", () => {
    const notes = visualNotesOf(doc, [
      { slide: 2, problem: " Wall of text. ", fix: "Cut the body." },
      { slide: 2, problem: "wall  of text.", fix: "Again." },
      { slide: 3, problem: "No such slide.", fix: "x" },
      { slide: 1, problem: "", fix: "empty problem" },
    ]);
    expect(notes).toEqual([
      { slide: 2, slideId: "b", problem: "Wall of text.", fix: "Cut the body." },
    ]);
  });

  it("tells the model whether it can see the slides", () => {
    const base = {
      document: doc,
      layouts: [
        { layout: "cover", role: "cover" },
        { layout: "text", role: "text" },
      ],
      measured: [{ slide: 0, slot: "title", kind: "widow", message: "One word on the last line" }],
      language: "en",
    };
    const text = visualUserPrompt({ ...base, withImages: false });
    expect(text).toContain("No images are attached");
    expect(text).toContain("slide 1, title: widow");
    expect(visualUserPrompt({ ...base, withImages: true })).toContain("attached in order");
  });
});
