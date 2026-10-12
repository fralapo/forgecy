import { describe, expect, it } from "vitest";
import {
  CONTENT_PROMPT_VERSION,
  PLAN_SYSTEM,
  VIDEO_TO_STATIC_RULE,
  planOutputSchema,
} from "../src/ai/prompts";
import { planItemInputSchema } from "../src/document";

const item = {
  day: 3,
  channel: "instagram" as const,
  pillarId: "p1",
  rubricId: "",
  theme: "Dietro le quinte",
  hook: "Un giorno in bottega",
  notes: "",
  productIds: [],
};

describe("video ideas become static", () => {
  it("the planner prompt carries the rule", () => {
    expect(PLAN_SYSTEM).toContain(VIDEO_TO_STATIC_RULE);
    expect(PLAN_SYSTEM).toMatch(/Static only, no video at any stage/);
    expect(PLAN_SYSTEM).toContain("convertedFromVideo");
    expect(PLAN_SYSTEM).toContain("conversionNote");
  });
  it("the prompt version moved past the one before this rule", () => {
    expect(CONTENT_PROMPT_VERSION).toBe("content-2026-10-11f");
  });
  it("the proposal fields are optional and typed", () => {
    const old = planOutputSchema.parse({
      items: [item],
      criticalNode: "",
      clientNeeds: [],
      rationale: "x",
    });
    expect(old.items[0]).toMatchObject({ convertedFromVideo: false, conversionNote: "" });
    const converted = planOutputSchema.parse({
      items: [
        {
          ...item,
          convertedFromVideo: true,
          conversionNote: "Reel on the workshop: 5-slide carousel.",
        },
      ],
      criticalNode: "",
      clientNeeds: [],
      rationale: "x",
    });
    expect(converted.items[0]?.convertedFromVideo).toBe(true);
    expect(() =>
      planOutputSchema.parse({
        items: [{ ...item, conversionNote: "x".repeat(201) }],
        criticalNode: "",
        clientNeeds: [],
        rationale: "x",
      }),
    ).toThrow();
  });
  it("stored plan items without the fields still validate", () => {
    const r = planItemInputSchema.parse({
      day: 1,
      channel: "instagram",
      format: "ig_4x5",
      pillarId: "0f0c8a2e-5d41-4f55-9a07-0f3d2f6c9b11",
      theme: "T",
      productIds: [],
    });
    expect(r.convertedFromVideo).toBe(false);
    expect(r.conversionNote).toBe("");
  });
});
