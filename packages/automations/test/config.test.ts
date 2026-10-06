import { describe, expect, it } from "vitest";
import {
  automationItemSchema,
  automationParamsSchema,
  configBlockers,
  itemIssues,
  itemTarget,
  readItems,
  readParams,
} from "../src/config";
import { policyBlocker, runOutcome } from "../src/service";

const item = (over: Record<string, unknown> = {}) =>
  automationItemSchema.parse({
    id: "a1",
    brief: "Explain why the bottle keeps water cool on a hike.",
    objective: "education",
    ...over,
  });

describe("automation configuration", () => {
  it("marks incomplete items with the reason", () => {
    expect(itemIssues(item())).toEqual([]);
    expect(itemIssues(item({ brief: "too short", objective: null }))).toEqual([
      "briefTooShort",
      "noObjective",
    ]);
  });

  it("blocks the start for no items, incomplete items or too many", () => {
    expect(configBlockers([])).toEqual(["noItems"]);
    expect(configBlockers([item(), item({ objective: null })])).toEqual(["incompleteItems"]);
    expect(configBlockers(Array.from({ length: 21 }, () => item()))).toEqual(["tooManyItems"]);
  });

  it("applies the item overrides of format and channel", () => {
    const params = automationParamsSchema.parse({});
    expect(itemTarget(item(), params)).toEqual({ format: "ig_4x5", channel: "instagram" });
    expect(itemTarget(item({ channel: "linkedin" }), params).channel).toBe("linkedin");
  });

  it("reads stored JSON leniently", () => {
    expect(readParams({ slideCount: 99 })).toEqual(automationParamsSchema.parse({}));
    expect(readItems([{ id: "x" }, { nope: true }, "bad"])).toHaveLength(1);
    expect(readItems(null)).toEqual([]);
  });
});

describe("run outcome and policy", () => {
  const counts = (c: Partial<Record<"completed" | "failed" | "cancelled", number>>) => ({
    total: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    costMicroUsd: 0,
    ...c,
  });

  it("is partial when some items failed and some completed", () => {
    expect(runOutcome(counts({ completed: 3 }))).toBe("completed");
    expect(runOutcome(counts({ completed: 2, failed: 1 }))).toBe("partial");
    expect(runOutcome(counts({ failed: 2 }))).toBe("failed");
    expect(runOutcome(counts({ completed: 1, cancelled: 2 }))).toBe("cancelled");
  });

  it("blocks no AI, and local only without a local model", () => {
    expect(policyBlocker("no_ai", true)).toBe("noAi");
    expect(policyBlocker("local_only", false)).toBe("localOnlyNoModel");
    expect(policyBlocker("local_only", true)).toBeNull();
    expect(policyBlocker("external_allowed", false)).toBeNull();
  });
});
