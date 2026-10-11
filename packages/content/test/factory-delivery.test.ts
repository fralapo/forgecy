import { describe, expect, it } from "vitest";
import { planNotesBlock, planUserPrompt, strategyUserPrompt } from "../src/ai/prompts";
import { isEditable, isPublished } from "../src/carousels/carousels";
import { pillarInputSchema, planNotesSchema, rubricInputSchema } from "../src/document";

describe("published contents are frozen", () => {
  const at = new Date("2026-10-11T10:00:00Z");
  it("knows a published content", () => {
    expect(isPublished({ publishedAt: null })).toBe(false);
    expect(isPublished({ publishedAt: at })).toBe(true);
  });
  it("lets only unpublished drafts, approved and exported contents be edited", () => {
    for (const status of ["draft", "changes_requested", "approved", "exported"] as const)
      expect(isEditable({ status, publishedAt: null })).toBe(true);
    for (const status of ["in_review", "archived"] as const)
      expect(isEditable({ status, publishedAt: null })).toBe(false);
    expect(isEditable({ status: "exported", publishedAt: at })).toBe(false);
    expect(isEditable({ status: "approved", publishedAt: at })).toBe(false);
  });
});

describe("strategy leftovers", () => {
  it("keeps older pillars and rubrics valid with empty new fields", () => {
    const pillar = pillarInputSchema.parse({ name: "Care" });
    expect(pillar).toMatchObject({ territory: "", metric: "" });
    const rubric = rubricInputSchema.parse({ pillarId: crypto.randomUUID(), name: "Tips" });
    expect(rubric).toMatchObject({ cost: "", metric: "" });
  });
  it("validates the plan notes", () => {
    expect(planNotesSchema.parse({})).toEqual({
      criticalNode: "",
      clientNeeds: [],
      countRationale: "",
    });
    expect(planNotesSchema.safeParse({ clientNeeds: ["", "x"] }).success).toBe(false);
    expect(planNotesSchema.safeParse({ criticalNode: "x".repeat(301) }).success).toBe(false);
  });
  it("puts territory, metric, cost and the plan notes in the Planner context", () => {
    const strategy = strategyUserPrompt({
      clientName: "Acme",
      audience: [],
      existingPillars: [
        { id: "p1", name: "Care", goal: "g", territory: "Slow beauty", metric: "saves" },
      ],
      existingRubrics: [],
      products: [],
      instruction: "",
      language: "en",
    });
    expect(strategy).toContain("territory: Slow beauty; metric: saves");
    const plan = planUserPrompt({
      clientName: "Acme",
      language: "en",
      channels: ["instagram"],
      pillars: [{ id: "p1", name: "Care", goal: "g", frequency: "1/week", metric: "saves" }],
      rubrics: [
        { id: "r1", pillarId: "p1", name: "Tips", frequency: "", hookFormula: "", cost: "2h" },
      ],
      notes: { criticalNode: "No leads", clientNeeds: ["Calls"], countRationale: "Small team" },
      products: [],
      instruction: "",
    });
    expect(plan).toContain("cost: 2h");
    expect(plan).toContain("Critical node (the one bottleneck to work on): No leads");
    expect(plan).toContain("What the client needs: Calls");
  });
  it("adds nothing without plan notes", () => {
    expect(planNotesBlock(undefined)).toBe("");
    expect(planNotesBlock({ criticalNode: "", clientNeeds: [] })).toBe("");
  });
});
