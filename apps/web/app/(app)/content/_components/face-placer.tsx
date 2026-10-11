"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  faceBoxFromCorners,
  faceBoxToPercent,
  pointToFraction,
  stepCursor,
  type FaceBox,
  type Point,
} from "../_lib/face-box";

/** A drag shorter than this (px) counts as a click. */
const DRAG_PX = 6;

/**
 * Draw the face box on the photo: drag, or click twice (top-left, then bottom-right), or move a
 * keyboard cursor with the arrows and press Enter on each corner. The number fields stay the
 * accessible fallback; both write the same `face` fractions.
 */
export function FacePlacer({
  url,
  alt,
  width,
  height,
  face,
  onChange,
}: {
  url: string;
  alt: string;
  width: number;
  height: number;
  face: FaceBox | undefined;
  onChange: (face: FaceBox) => void;
}) {
  const t = useTranslations("content.editor.imageSlot.face");
  const hintId = useId();
  const [first, setFirst] = useState<Point | null>(null);
  const [drag, setDrag] = useState<{ start: Point; now: Point } | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0.5, y: 0.5 });
  const [focused, setFocused] = useState(false);

  const commit = (a: Point, b: Point) => {
    onChange(faceBoxFromCorners(a, b));
    setFirst(null);
    setDrag(null);
  };
  const corner = (p: Point) => (first ? commit(first, p) : setFirst(p));
  const live = drag ? faceBoxFromCorners(drag.start, drag.now) : null;
  const shown = live ?? face;

  return (
    <div className="space-y-1">
      <div
        role="group"
        tabIndex={0}
        aria-label={t("place")}
        aria-describedby={hintId}
        className="relative w-full max-w-sm cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        style={{ aspectRatio: `${width} / ${height}` }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setFirst(null);
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pointToFraction(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          setDrag({ start: p, now: p });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const now = pointToFraction(
            e.clientX,
            e.clientY,
            e.currentTarget.getBoundingClientRect(),
          );
          setDrag({ start: drag.start, now });
        }}
        onPointerUp={(e) => {
          if (!drag) return;
          const r = e.currentTarget.getBoundingClientRect();
          const end = pointToFraction(e.clientX, e.clientY, r);
          const moved =
            Math.abs(end.x - drag.start.x) * r.width + Math.abs(end.y - drag.start.y) * r.height;
          setDrag(null);
          if (moved > DRAG_PX) commit(drag.start, end);
          else corner(end);
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          const next = stepCursor(cursor, e.key, e.shiftKey);
          if (next) {
            e.preventDefault();
            setCursor(next);
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            corner(cursor);
          } else if (e.key === "Escape") setFirst(null);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-fill"
        />
        {shown ? (
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-primary"
            style={{
              left: `${faceBoxToPercent(shown).left}%`,
              top: `${faceBoxToPercent(shown).top}%`,
              width: `${faceBoxToPercent(shown).width}%`,
              height: `${faceBoxToPercent(shown).height}%`,
            }}
          />
        ) : null}
        {first ? (
          <div
            aria-hidden
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${first.x * 100}%`, top: `${first.y * 100}%` }}
          />
        ) : null}
        {focused ? (
          <div
            aria-hidden
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-focus"
            style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }}
          />
        ) : null}
      </div>
      <p id={hintId} className="text-body-sm text-fg-muted">
        {t("placeHint")}
      </p>
      {first ? (
        <p role="status" className="text-body-sm text-fg">
          {t("cornerSet")}
        </p>
      ) : null}
    </div>
  );
}
