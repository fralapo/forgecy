import { describe, expect, it } from "vitest";
import { faceRenderFromJobs } from "../src/carousels/brand-guard";

const issue = (over: Record<string, unknown> = {}) => ({
  slide: 0,
  slot: "title",
  kind: "text_over_face",
  message: "m",
  ref: {
    key: "templates.renderIssues.textOverFace",
    values: { slot: "title", photo: "photo", percent: 40 },
  },
  ...over,
});
const job = (at: string, issues: unknown[] | undefined) => ({
  createdAt: new Date(at),
  result: issues ? { issues } : {},
});
const edited = new Date("2026-01-02T00:00:00Z");

describe("faceRenderFromJobs", () => {
  it("maps a fresh text_over_face issue", () => {
    expect(faceRenderFromJobs([job("2026-01-03T00:00:00Z", [issue()])], edited)).toEqual({
      slides: [
        { slide: 0, slots: [], faceOverlaps: [{ slot: "title", photo: "photo", percent: 40 }] },
      ],
    });
  });
  it("ignores a result older than the last draft update", () => {
    expect(faceRenderFromJobs([job("2026-01-01T00:00:00Z", [issue()])], edited)).toBeUndefined();
  });
  it("gives nothing without a job or without stored issues", () => {
    expect(faceRenderFromJobs([], edited)).toBeUndefined();
    expect(faceRenderFromJobs([job("2026-01-03T00:00:00Z", undefined)], edited)).toBeUndefined();
  });
  it("skips a newer job without issues and uses the next one", () => {
    const rows = [job("2026-01-04T00:00:00Z", undefined), job("2026-01-03T00:00:00Z", [issue()])];
    expect(faceRenderFromJobs(rows, edited)?.slides).toHaveLength(1);
  });
  it("does not map other kinds or malformed face issues", () => {
    const rows = [
      job("2026-01-03T00:00:00Z", [issue({ kind: "overflow" }), issue({ ref: undefined }), null]),
    ];
    expect(faceRenderFromJobs(rows, edited)).toBeUndefined();
  });
});
