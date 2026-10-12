import { describe, expect, it } from "vitest";
import {
  faceBoxFromCorners,
  faceBoxToPercent,
  MIN_FACE_SIDE,
  pointToFraction,
  stepCursor,
} from "./face-box";

const rect = { left: 100, top: 50, width: 200, height: 400 };

describe("face box geometry", () => {
  it("maps a pointer to fractions of the displayed photo and clamps outside it", () => {
    expect(pointToFraction(200, 250, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointToFraction(0, 9999, rect)).toEqual({ x: 0, y: 1 });
    expect(pointToFraction(10, 10, { ...rect, width: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("builds the centre and size from two corners in any order", () => {
    const box = faceBoxFromCorners({ x: 0.2, y: 0.1 }, { x: 0.6, y: 0.5 });
    expect(box.cx).toBeCloseTo(0.4);
    expect(box.cy).toBeCloseTo(0.3);
    expect(box.w).toBeCloseTo(0.4);
    expect(box.h).toBeCloseTo(0.4);
    expect(faceBoxFromCorners({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual(box);
  });

  it("never returns a box thinner than the schema minimum and keeps it inside the photo", () => {
    const dot = faceBoxFromCorners({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 });
    expect(dot.w).toBe(MIN_FACE_SIDE);
    expect(dot.h).toBe(MIN_FACE_SIDE);
    const edge = faceBoxFromCorners({ x: 1, y: 1 }, { x: 1, y: 1 });
    expect(edge.cx + edge.w / 2).toBeLessThanOrEqual(1);
    expect(edge.cy + edge.h / 2).toBeLessThanOrEqual(1);
  });

  it("round-trips a box to CSS percentages", () => {
    const p = faceBoxToPercent({ cx: 0.4, cy: 0.3, w: 0.4, h: 0.4 });
    expect(p.left).toBeCloseTo(20);
    expect(p.top).toBeCloseTo(10);
    expect(p.width).toBeCloseTo(40);
    expect(p.height).toBeCloseTo(40);
    // A hand-typed box that sticks out is cut at the photo edge.
    const out = faceBoxToPercent({ cx: 0.95, cy: 0.5, w: 0.4, h: 0.2 });
    expect(out.left + out.width).toBeCloseTo(100);
  });

  it("moves the keyboard cursor with the arrows, 10% with Shift, and ignores other keys", () => {
    expect(stepCursor({ x: 0.5, y: 0.5 }, "ArrowRight", false)).toEqual({ x: 0.51, y: 0.5 });
    expect(stepCursor({ x: 0.5, y: 0.5 }, "ArrowUp", true)).toEqual({ x: 0.5, y: 0.4 });
    expect(stepCursor({ x: 0, y: 1 }, "ArrowLeft", true)).toEqual({ x: 0, y: 1 });
    expect(stepCursor({ x: 0.5, y: 0.5 }, "a", false)).toBeNull();
  });
});
