import { describe, expect, it } from "vitest";
import { checkContent } from "../src/checks";
import { applyIssueStates, approvalGate } from "../src/review";
import type { GuardRender } from "../src/types";
import { brand, content } from "./fixtures";

const now = new Date("2026-10-06T10:00:00Z");
const run = (render?: GuardRender, flagUnverifiedRender = true) =>
  checkContent(content(), brand(), render, { now, flagUnverifiedRender });

describe("render not measured", () => {
  it("is not flagged unless asked (pure callers keep their findings)", () => {
    expect(run(undefined, false).findings).toEqual([]);
  });

  it("adds one warning that names what was not verified, outside the score", () => {
    const r = run();
    expect(r.findings.map((f) => `${f.check}:${f.severity}:${f.category}`)).toEqual([
      "render_unverified:warning:layout",
    ]);
    expect(r.findings[0]).toMatchObject({ slide: null, slot: null, origin: "json" });
    expect(r.findings[0]!.message).toMatch(/not checked on the rendered slides/i);
    expect(r.counts).toEqual({ error: 0, warning: 1, note: 0 });
    expect(r.coherence.score).toBe(100);
    expect(r.hasRender).toBe(false);
  });

  it("is absent once a render was measured", () => {
    const r = run({ slides: [] });
    expect(r.hasRender).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("must be seen before approval and still does not lower the applied score", () => {
    const r = run();
    const reviewed = applyIssueStates(r, []);
    expect(reviewed.coherence.score).toBe(100);
    expect(approvalGate(reviewed).toAcknowledge.map((f) => f.check)).toEqual(["render_unverified"]);
    expect(approvalGate(reviewed).ready).toBe(false);
    expect(approvalGate(reviewed, [r.findings[0]!.key]).ready).toBe(true);
  });
});
