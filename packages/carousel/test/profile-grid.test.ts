import { describe, expect, it } from "vitest";
import { profileGridCrop } from "../src/formats";

describe("profileGridCrop", () => {
  it("centers the 1:1 crop on a 4:5 slide", () => {
    expect(profileGridCrop("ig_4x5", "1:1")).toEqual({ x: 0, y: 135, width: 1080, height: 1080 });
  });

  it("centers the 3:4 crop on a 4:5 slide, losing only a sliver of width", () => {
    expect(profileGridCrop("ig_4x5", "3:4")).toEqual({ x: 34, y: 0, width: 1013, height: 1350 });
  });

  it("crops a 9:16 slide to 1:1 and 3:4 from the middle", () => {
    expect(profileGridCrop("stories_9x16", "1:1")).toEqual({
      x: 0,
      y: 420,
      width: 1080,
      height: 1080,
    });
    expect(profileGridCrop("stories_9x16", "3:4")).toEqual({
      x: 0,
      y: 240,
      width: 1080,
      height: 1440,
    });
  });

  it("keeps a square slide whole at 1:1 and narrows it at 3:4", () => {
    expect(profileGridCrop("ig_1x1", "1:1")).toEqual({ x: 0, y: 0, width: 1080, height: 1080 });
    expect(profileGridCrop("ig_1x1", "3:4")).toEqual({ x: 135, y: 0, width: 810, height: 1080 });
  });
});
