/** Instagram draws its carousel icon over this square at the top-right of the cover. */
export const COVER_CORNER_PX = 120;
/** The bottom of a slide is for the page number only. */
export const BOTTOM_ZONE_PX = 100;
/** Text keeps at least this far from the slide edges. */
export const MIN_MARGIN_PX = 80;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type GeometryProblem = "cover_corner" | "bottom_zone" | "edge_margin";

/**
 * Where a text block (its ink when measured, else its box) breaks the placement rules of a
 * feed slide. Pure: the sizes come from the measurement.
 */
export function geometryProblems(
  box: Box,
  size: { width: number; height: number },
  cover: boolean,
): GeometryProblem[] {
  const e = 0.5;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const out: GeometryProblem[] = [];
  if (cover && right > size.width - COVER_CORNER_PX + e && box.y < COVER_CORNER_PX - e)
    out.push("cover_corner");
  if (bottom > size.height - BOTTOM_ZONE_PX + e) out.push("bottom_zone");
  if (
    box.x < MIN_MARGIN_PX - e ||
    right > size.width - MIN_MARGIN_PX + e ||
    box.y < MIN_MARGIN_PX - e
  )
    out.push("edge_margin");
  return out;
}
