/**
 * Side-by-side comparison of two carousel versions (v1): slides are paired by their
 * stable id, so a moved slide reads as the same slide in another position. Browser-safe.
 */
import type { CarouselDocument, ContentSlide } from "../document";

export type SlideChange = "same" | "changed" | "added" | "removed";

export interface SlideComparison {
  slideId: string;
  /** Position in each version (0-based); null when the slide is not there. */
  leftIndex: number | null;
  rightIndex: number | null;
  change: SlideChange;
  /** Slots whose text or image differ, plus "layout" and "tone" when those changed. */
  changedParts: string[];
  moved: boolean;
}

export interface CarouselComparison {
  slides: SlideComparison[];
  captionChanged: boolean;
  hashtagsChanged: boolean;
  /** Slides that are not identical, for the summary line. */
  changedCount: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function changedParts(a: ContentSlide, b: ContentSlide): string[] {
  const parts: string[] = [];
  if (a.layout !== b.layout) parts.push("layout");
  if ((a.tone ?? null) !== (b.tone ?? null)) parts.push("tone");
  const names = [...new Set([...Object.keys(a.slots), ...Object.keys(b.slots)])];
  for (const n of names) if (!same(a.slots[n], b.slots[n])) parts.push(n);
  return parts;
}

/** Slides in the order of the right (newer) version, removed ones after their old neighbour. */
export function compareCarouselVersions(
  left: CarouselDocument,
  right: CarouselDocument,
): CarouselComparison {
  const leftIndex = new Map(left.slides.map((s, i) => [s.id, i]));
  const rightIds = new Set(right.slides.map((s) => s.id));
  const rows: SlideComparison[] = right.slides.map((s, i) => {
    const li = leftIndex.get(s.id);
    if (li === undefined)
      return {
        slideId: s.id,
        leftIndex: null,
        rightIndex: i,
        change: "added",
        changedParts: [],
        moved: false,
      };
    const parts = changedParts(left.slides[li]!, s);
    return {
      slideId: s.id,
      leftIndex: li,
      rightIndex: i,
      change: parts.length ? "changed" : "same",
      changedParts: parts,
      moved: li !== i,
    };
  });
  left.slides.forEach((s, i) => {
    if (rightIds.has(s.id)) return;
    const removed: SlideComparison = {
      slideId: s.id,
      leftIndex: i,
      rightIndex: null,
      change: "removed",
      changedParts: [],
      moved: false,
    };
    // After the row of the slide that preceded it in the left version.
    const prev = left.slides[i - 1]?.id;
    const at = prev ? rows.findIndex((r) => r.slideId === prev) : -1;
    rows.splice(at + 1, 0, removed);
  });
  return {
    slides: rows,
    captionChanged: left.caption !== right.caption,
    hashtagsChanged: !same(left.hashtags, right.hashtags),
    changedCount: rows.filter((r) => r.change !== "same" || r.moved).length,
  };
}
