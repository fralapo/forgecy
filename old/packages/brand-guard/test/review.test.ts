import { describe, expect, it } from "vitest";
import { checkContent } from "../src/checks";
import {
  applyIssueStates,
  approvalGate,
  exportGate,
  findingsAsText,
  type IssueState,
} from "../src/review";
import type { GuardTextSlot } from "../src/types";
import { brand, content } from "./fixtures";

const now = new Date("2026-10-06T10:00:00Z");

function report(title = "Prodotto economico, ecommerce facile") {
  const c = content();
  (c.slides[1]!.slots[0] as GuardTextSlot).text = title;
  return checkContent(c, brand(), undefined, { now });
}

const state = (
  over: Partial<IssueState> & Pick<IssueState, "findingKey" | "blockHash" | "status">,
): IssueState => ({ subjectVersion: null, userId: "u1", createdAt: now, ...over });

const acks = (r: ReturnType<typeof report>, subjectVersion: number) =>
  r.findings.map((f) =>
    state({ findingKey: f.key, blockHash: f.blockHash, status: "acknowledged", subjectVersion }),
  );

describe("people's decisions on findings", () => {
  it("ignores warnings with a reason and never errors", () => {
    const r = report();
    const warning = r.findings.find((f) => f.check === "spelling")!;
    const error = r.findings.find((f) => f.check === "forbidden_word")!;
    const reviewed = applyIssueStates(r, [
      state({
        findingKey: warning.key,
        blockHash: warning.blockHash,
        status: "ignored",
        reason: "client_request",
      }),
      state({
        findingKey: error.key,
        blockHash: error.blockHash,
        status: "ignored",
        reason: "other",
        note: "x",
      }),
    ]);
    expect(reviewed.findings.find((f) => f.key === warning.key)).toMatchObject({
      status: "ignored",
      ignored: { by: "u1", reason: "client_request" },
    });
    expect(reviewed.findings.find((f) => f.key === error.key)?.status).toBe("open");
    expect(reviewed.open).toEqual({ error: 1, warning: 0, note: 0 });
    expect(reviewed.ignoredCount.warning).toBe(1);
    // Ignored findings no longer lower the coherence.
    expect(reviewed.coherence.score).toBe(85);
  });

  it("reopens an ignored finding when its block changes", () => {
    const warning = report().findings.find((f) => f.check === "spelling")!;
    const ignore = state({
      findingKey: warning.key,
      blockHash: warning.blockHash,
      status: "ignored",
      reason: "creative_choice",
    });
    const after = report("Other text with ecommerce");
    const again = after.findings.find((f) => f.check === "spelling")!;
    expect(again.key).toBe(warning.key);
    expect(
      applyIssueStates(after, [ignore]).findings.find((f) => f.key === again.key)?.status,
    ).toBe("open");
  });

  it("lists findings resolved since the previous run", () => {
    const reviewed = applyIssueStates(report("Prodotto accessibile, ecommerce facile"), [], {
      previous: report(),
    });
    expect(reviewed.resolved.map((f) => f.check)).toEqual(["forbidden_word"]);
  });
});

describe("approval and export gates", () => {
  it("needs “I’ve seen it” on every open error and warning of this version", () => {
    const r = report();
    const keys = r.findings.map((f) => f.key);
    const reviewed = applyIssueStates(r, [], { subjectVersion: 2 });
    expect(approvalGate(reviewed).toAcknowledge.map((f) => f.key)).toEqual(keys);
    expect(approvalGate(reviewed, keys).ready).toBe(true);
    // An acknowledgement given on another version does not count.
    expect(approvalGate(applyIssueStates(r, acks(r, 1), { subjectVersion: 2 })).ready).toBe(false);
    expect(approvalGate(applyIssueStates(r, acks(r, 2), { subjectVersion: 2 })).ready).toBe(true);
  });

  it("blocks approval on AI images whatever is acknowledged", () => {
    const c = content();
    c.slides[1]!.slots.push({
      kind: "image",
      name: "photo",
      asset: { id: "a1", origin: "ai", approval: "draft", width: 2000, height: 2000 },
    });
    const r = checkContent(c, brand(), undefined, { now });
    const gate = approvalGate(
      applyIssueStates(r, []),
      r.findings.map((f) => f.key),
    );
    expect(gate.ready).toBe(false);
    expect(gate.blockers.map((f) => f.check)).toEqual(["ai_image_unapproved"]);
  });

  it("never blocks the export on findings, only on missing approval", () => {
    const reviewed = applyIssueStates(report(), []);
    expect(exportGate(true, reviewed)).toEqual({
      allowed: true,
      openErrors: 1,
      openWarnings: 1,
      neverChecked: false,
    });
    expect(exportGate(false, null)).toMatchObject({ allowed: false, neverChecked: true });
  });

  it("copies the findings as plain text", () => {
    const text = findingsAsText(applyIssueStates(report(), []));
    expect(text.split("\n")[0]).toMatch(/^Error · Slide 2 · Title: “economico”/);
    expect(text).toContain("[spelling]");
  });
});
