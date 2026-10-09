import { messagesFor } from "@forgecy/i18n";
import { describe, expect, it } from "vitest";
import { issuesFromMeasures, type SlotMeasure } from "../src/export/capture";

const rect = { x: 0, y: 0, width: 100, height: 40 };
const text = (over: Partial<SlotMeasure> = {}): SlotMeasure => ({
  name: "title",
  kind: "text",
  overflow: false,
  outsideSlide: false,
  outsideSafe: false,
  lines: 1,
  naturalWidth: 0,
  naturalHeight: 0,
  rect,
  ...over,
});
const image = (over: Partial<SlotMeasure> = {}): SlotMeasure =>
  text({ name: "photo", kind: "image", ...over });

describe("render issues are translatable", () => {
  it.each([
    [[text({ overflow: true })], {}, "overflow", "The text of “title” overflows its box."],
    [[text({ outsideSlide: true })], {}, "outside_slide", "“title” goes outside the slide."],
    [[text({ outsideSafe: true })], {}, "outside_safe_zone", "“title” is outside the safe zone."],
    [
      [text({ lines: 4 })],
      { title: { maxLines: 3 } },
      "too_many_lines",
      "“title” takes 4 lines out of 3.",
    ],
    [[image({ naturalWidth: 0 })], {}, "image_missing", "The image of “photo” did not load."],
    [
      [image({ naturalWidth: 500, naturalHeight: 400 })],
      { photo: { minWidth: 1000 } },
      "low_resolution",
      "The image of “photo” is 500×400 px, below the minimum.",
    ],
  ])("%#: %s", (slots, limits, kind, english) => {
    const [issue] = issuesFromMeasures(0, slots, limits);
    expect(issue?.kind).toBe(kind);
    expect(issue?.message).toBe(english);
    expect(issue?.ref?.key).toMatch(/^templates\.renderIssues\./);
  });

  it("names both slots of an overlap", () => {
    const issues = issuesFromMeasures(2, [text({ name: "a" }), text({ name: "b" })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      slide: 2,
      kind: "overlap",
      message: "“a” overlaps “b”.",
      ref: { key: "templates.renderIssues.overlap", values: { slot: "a", other: "b" } },
    });
  });

  it("has Italian text for every issue", () => {
    const it_ = messagesFor("it").templates.renderIssues;
    const en = messagesFor("en").templates.renderIssues;
    expect(Object.keys(it_).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(it_[key]).not.toBe(en[key]);
  });
});
