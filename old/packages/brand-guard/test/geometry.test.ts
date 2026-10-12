import { describe, expect, it } from "vitest";
import { geometryProblems } from "../src/geometry";

const size = { width: 1080, height: 1350 };
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("geometryProblems", () => {
  it("accepts text inside the margins", () => {
    expect(geometryProblems(box(80, 200, 900, 300), size, true)).toEqual([]);
  });
  it("flags text in the top-right 120x120 of the cover only", () => {
    const corner = box(900, 80, 100, 40);
    expect(geometryProblems(corner, size, true)).toEqual(["cover_corner"]);
    expect(geometryProblems(corner, size, false)).toEqual([]);
    expect(geometryProblems(box(80, 80, 700, 40), size, true)).toEqual([]);
  });
  it("flags text in the bottom 100px", () => {
    expect(geometryProblems(box(80, 1200, 900, 100), size, false)).toEqual(["bottom_zone"]);
    expect(geometryProblems(box(80, 1200, 900, 40), size, false)).toEqual([]);
  });
  it("flags margins under 80px on the sides and the top", () => {
    expect(geometryProblems(box(40, 200, 600, 100), size, false)).toEqual(["edge_margin"]);
    expect(geometryProblems(box(80, 200, 950, 100), size, false)).toEqual(["edge_margin"]);
    expect(geometryProblems(box(80, 30, 600, 100), size, false)).toEqual(["edge_margin"]);
  });
});
