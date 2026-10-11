import { describe, expect, it } from "vitest";
import { visualNotesOf } from "../src/ai/pipeline";
import {
  VISUAL_CHECKS,
  VISUAL_SYSTEM,
  visualNotesOutputSchema,
  visualUserPrompt,
} from "../src/ai/prompts";
import { carouselDocumentSchema } from "../src/document";
import { MAX_VISUAL_ROUNDS, nextVisualRound, orderVisualNotes } from "../src/visual-rounds";

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

describe("one atomic fix per round", () => {
  it("counts rounds, stops at the cap and opens a new series after a pass or a restart", () => {
    expect(MAX_VISUAL_ROUNDS).toBe(3);
    expect(nextVisualRound(null)).toBe(1);
    expect(nextVisualRound({ round: 1, notes: 2 })).toBe(2);
    expect(nextVisualRound({ round: 2, notes: 1 })).toBe(3);
    expect(nextVisualRound({ round: 3, notes: 1 })).toBeNull();
    expect(nextVisualRound({ round: 3, notes: 0 })).toBe(1);
    expect(nextVisualRound({ round: 3, notes: 1 }, true)).toBe(1);
  });

  it("orders notes by slide and keeps the reviewer's order within a slide", () => {
    const notes = [
      { slide: 3, problem: "c" },
      { slide: 1, problem: "a1" },
      { slide: 2, problem: "b" },
      { slide: 1, problem: "a2" },
    ];
    expect(orderVisualNotes(notes).map((n) => n.problem)).toEqual(["a1", "a2", "b", "c"]);
    expect(notes[0]!.problem).toBe("c");
  });
});
