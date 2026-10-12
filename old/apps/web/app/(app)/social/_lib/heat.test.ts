import { describe, expect, it } from "vitest";
import { heatLevel, heatmapMax, hourLabel } from "./heat";

describe("heatLevel", () => {
  it("is 0 only without posts", () => {
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(1, 100)).toBe(1);
  });
  it("scales to the busiest slot", () => {
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(3, 5)).toBe(3);
    expect(heatLevel(2, 4)).toBe(2);
  });
  it("copes with an empty grid", () => {
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatmapMax([])).toBe(0);
    expect(heatmapMax([[0, 2], [3]])).toBe(3);
  });
  it("pads the hour", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(21)).toBe("21:00");
  });
});
