/** Pure geometry of the face-box overlay: everything is a fraction (0..1) of the photo. */

export interface Point {
  x: number;
  y: number;
}
export interface FaceBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Smallest box the slide schema accepts (1% of the photo). */
export const MIN_FACE_SIDE = 0.01;
export const KEY_STEP = 0.01;
export const KEY_STEP_BIG = 0.1;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A pointer position inside the displayed photo (`rect` from getBoundingClientRect) as fractions, clamped to the photo. */
export function pointToFraction(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/** The box with two opposite corners given in any order; never thinner than the schema's minimum. */
export function faceBoxFromCorners(a: Point, b: Point): FaceBox {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const w = Math.min(1, Math.max(MIN_FACE_SIDE, Math.abs(a.x - b.x)));
  const h = Math.min(1, Math.max(MIN_FACE_SIDE, Math.abs(a.y - b.y)));
  // A box pushed past the right/bottom edge by the minimum side is shifted back inside.
  const left = Math.min(x0, 1 - w);
  const top = Math.min(y0, 1 - h);
  return { cx: left + w / 2, cy: top + h / 2, w, h };
}

/** Position and size of the box as CSS percentages of the photo, kept inside it. */
export function faceBoxToPercent(face: FaceBox): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const left = clamp01(face.cx - face.w / 2);
  const top = clamp01(face.cy - face.h / 2);
  const right = clamp01(face.cx + face.w / 2);
  const bottom = clamp01(face.cy + face.h / 2);
  return {
    left: left * 100,
    top: top * 100,
    width: (right - left) * 100,
    height: (bottom - top) * 100,
  };
}

/** Arrow-key movement of the keyboard cursor (Shift moves by 10%). Other keys return null. */
export function stepCursor(cursor: Point, key: string, big: boolean): Point | null {
  const step = big ? KEY_STEP_BIG : KEY_STEP;
  const move: Record<string, Point> = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  };
  const d = move[key];
  return d ? { x: clamp01(cursor.x + d.x), y: clamp01(cursor.y + d.y) } : null;
}
