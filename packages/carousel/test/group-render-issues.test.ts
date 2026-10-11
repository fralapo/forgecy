import { describe, expect, it } from "vitest";
import { groupRenderIssues } from "../src/render-issues";

const manifest = {
  layouts: [{ id: "cover", slots: [{ name: "title", label: "Titolo" }] }],
} as never;

describe("groupRenderIssues", () => {
  it("is empty for nothing or junk", () => {
    expect(groupRenderIssues(undefined, null, () => null)).toEqual([]);
    expect(groupRenderIssues([null, { slide: "x" }], null, () => null)).toEqual([]);
  });
  it("groups by slide, errors first, with the slot label and default severities", () => {
    const ref = { key: "templates.renderIssues.overlap", values: { slot: "title" } };
    const g = groupRenderIssues(
      [
        { slide: 2, slot: "a", kind: "widow", message: "w" },
        { slide: 0, slot: "title", kind: "narrow_text", message: "n", ref },
        { slide: 0, slot: "title", kind: "text_over_face", message: "f", severity: "error" },
        { slide: 0, slot: "title", kind: "overflow", message: "o" },
      ],
      manifest,
      () => "cover",
    );
    expect(g.map((x) => x.slide)).toEqual([0, 2]);
    expect(g[0]!.issues.map((i) => `${i.kind}:${i.severity}`)).toEqual([
      "text_over_face:error",
      "overflow:error",
      "narrow_text:warning",
    ]);
    expect(g[0]!.issues[2]!.ref?.values?.slot).toBe("Titolo");
    expect(g[1]!.issues[0]!.severity).toBe("warning");
  });
});
