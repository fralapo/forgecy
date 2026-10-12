export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A face as the editor declares it: centre and size, as fractions of the photo. */
export interface FaceFractions {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Text may cover this share of a face before the check speaks (the source factory's 12%). */
export const FACE_MAX_COVERED = 0.12;

/**
 * Where the face lands on the slide once the photo is drawn with `object-fit: cover` and
 * `object-position: focal` inside `box`. The overflow is cropped, so the scale is the larger
 * of the two ratios and the focal point decides how much of each side is cut.
 */
export function faceRectOnSlide(
  face: FaceFractions,
  photo: { width: number; height: number },
  box: Rect,
  focal: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Rect | null {
  if (photo.width <= 0 || photo.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.max(box.width / photo.width, box.height / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  const ox = box.x + (box.width - dw) * focal.x;
  const oy = box.y + (box.height - dh) * focal.y;
  return {
    x: ox + (face.cx - face.w / 2) * dw,
    y: oy + (face.cy - face.h / 2) * dh,
    width: face.w * dw,
    height: face.h * dh,
  };
}

/**
 * Percent of the face covered by `text`, when it is above the limit; `null` otherwise.
 * The face area is the denominator: a face partly outside the slide is judged whole.
 */
export function faceCoveredPercent(text: Rect, face: Rect): number | null {
  const w = Math.min(text.x + text.width, face.x + face.width) - Math.max(text.x, face.x);
  const h = Math.min(text.y + text.height, face.y + face.height) - Math.max(text.y, face.y);
  const area = face.width * face.height;
  if (w <= 0 || h <= 0 || area <= 0) return null;
  const covered = (w * h) / area;
  return covered > FACE_MAX_COVERED ? Math.round(covered * 100) : null;
}
