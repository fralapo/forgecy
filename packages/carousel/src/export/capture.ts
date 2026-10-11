/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { Locale, MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { Browser, Page } from "playwright-core";
import type { RenderedSlide } from "../renderer";
import type { SafeZone } from "../formats";
import {
  MAX_BLOCK_LINES,
  MIN_FONT_PX,
  narrowTextPercent,
  typographyProblems,
} from "../typography/lines";

/** Problems seen on the rendered page (spec: Brand Guard checks on the render, not only the JSON). */
export type RenderIssueKind =
  | "overflow"
  | "outside_slide"
  | "outside_safe_zone"
  | "overlap"
  | "too_many_lines"
  | "low_resolution"
  | "image_missing"
  | "widow"
  | "bad_line_end"
  | "small_font"
  | "dense_block"
  | "narrow_text";

export interface RenderIssue {
  /** 0-based slide index. */
  slide: number;
  slot: string;
  kind: RenderIssueKind;
  message: string;
  /** The message in the reader's language; `message` stays English for logs and fallbacks. */
  ref?: MessageRef;
}

export interface SlotMeasure {
  name: string;
  kind: "text" | "image";
  overflow: boolean;
  outsideSlide: boolean;
  outsideSafe: boolean;
  lines: number;
  naturalWidth: number;
  naturalHeight: number;
  rect: { x: number; y: number; width: number; height: number };
  /** Text of each rendered line (text slots), for widow and line-end checks. */
  lineTexts?: string[];
  /** Computed font size in px (text slots). */
  fontSize?: number;
  /** Box around the glyphs actually drawn, tighter than `rect` (text slots). */
  ink?: { x: number; y: number; width: number; height: number };
  /**
   * Widest rendered line as a fraction of the box's content width (text slots). Absent for
   * slots with highlight or break markers or list items, where short lines are intentional.
   */
  fill?: number;
}

export interface CaptureInput {
  rendered: RenderedSlide;
  safeZone: SafeZone;
  /** Slot limits used to turn measures into issues. */
  limits?: Record<string, { maxLines?: number; minWidth?: number; minHeight?: number }>;
  /** Language of the copy; when set, the slide is also checked for typography. */
  language?: Locale;
}

export interface Capture {
  png: Uint8Array;
  slots: SlotMeasure[];
  issues: RenderIssue[];
}

/** Runs inside the page: geometry of every filled slot. Kept free of closures. */
function measureInPage(safe: SafeZone): SlotMeasure[] {
  const root = document.querySelector(".fc-slide") as HTMLElement;
  const W = root.offsetWidth;
  const H = root.offsetHeight;
  const out: SlotMeasure[] = [];
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("[data-slot]:not([data-empty])"),
  )) {
    const r = el.getBoundingClientRect();
    const isImg = el.tagName === "IMG";
    let lines = 0;
    let lineTexts: string[] | undefined;
    let ink: SlotMeasure["ink"];
    let fontSize: number | undefined;
    let fill: number | undefined;
    if (!isImg) {
      // One range per character: its line is its top, its ink the union of the boxes.
      const byTop = new Map<number, string>();
      const widths = new Map<number, [number, number]>();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const data = n.textContent ?? "";
        fontSize ??= parseFloat(getComputedStyle(n.parentElement ?? el).fontSize);
        for (let i = 0; i < data.length; i++) {
          const cr = document.createRange();
          cr.setStart(n, i);
          cr.setEnd(n, i + 1);
          const b = cr.getBoundingClientRect();
          if (b.width <= 0 || b.height <= 0) continue;
          const top = Math.round(b.top);
          byTop.set(top, (byTop.get(top) ?? "") + data[i]);
          if (data[i]!.trim()) {
            const w = widths.get(top) ?? [Infinity, -Infinity];
            widths.set(top, [Math.min(w[0], b.left), Math.max(w[1], b.right)]);
            x0 = Math.min(x0, b.left);
            y0 = Math.min(y0, b.top);
            x1 = Math.max(x1, b.right);
            y1 = Math.max(y1, b.bottom);
          }
        }
      }
      lines = byTop.size;
      lineTexts = [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.trim());
      const cs = getComputedStyle(el);
      const box = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (box > 0 && !el.querySelector("br, mark, li"))
        fill = Math.max(0, ...[...widths.values()].map(([a, b]) => b - a)) / box;
      if (x1 > x0) ink = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    // Clipped: the slot hides its own overflow, or spills past an ancestor that does.
    // (Glyph ink beyond a tight line-height grows scrollHeight but is not a clip.)
    const tol = 2;
    let clipped =
      !isImg &&
      getComputedStyle(el).overflow !== "visible" &&
      (el.scrollHeight > el.clientHeight + tol || el.scrollWidth > el.clientWidth + tol);
    for (let a = el.parentElement; !clipped && a && a !== root.parentElement; a = a.parentElement) {
      if (getComputedStyle(a).overflow === "visible") continue;
      const ar = a.getBoundingClientRect();
      clipped =
        r.bottom > ar.bottom + tol ||
        r.right > ar.right + tol ||
        r.top < ar.top - tol ||
        r.left < ar.left - tol;
    }
    const e = 0.5;
    out.push({
      name: el.dataset.slot ?? "",
      kind: isImg ? "image" : "text",
      overflow: clipped,
      outsideSlide: r.left < -e || r.top < -e || r.right > W + e || r.bottom > H + e,
      outsideSafe:
        r.left < safe.left - e ||
        r.top < safe.top - e ||
        r.right > W - safe.right + e ||
        r.bottom > H - safe.bottom + e,
      lines,
      ...(lineTexts ? { lineTexts } : {}),
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(ink ? { ink } : {}),
      ...(fill !== undefined ? { fill } : {}),
      naturalWidth: isImg ? (el as HTMLImageElement).naturalWidth : 0,
      naturalHeight: isImg ? (el as HTMLImageElement).naturalHeight : 0,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    });
  }
  return out;
}

function intersects(a: SlotMeasure["rect"], b: SlotMeasure["rect"]): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 2 && h > 2;
}

export function issuesFromMeasures(
  slide: number,
  slots: SlotMeasure[],
  limits: CaptureInput["limits"] = {},
  /** Language of the copy; typography is checked only when given. */
  language?: Locale,
): RenderIssue[] {
  const issues: RenderIssue[] = [];
  const add = (
    slot: string,
    kind: RenderIssueKind,
    key: MessageKey & `templates.renderIssues.${string}`,
    values: MessageValues,
  ) =>
    issues.push({
      slide,
      slot,
      kind,
      message: englishMessage(key, values),
      ref: messageRef(key, values),
    });
  for (const s of slots) {
    const lim = limits[s.name] ?? {};
    const slot = s.name;
    if (s.kind === "text") {
      if (s.overflow) add(slot, "overflow", "templates.renderIssues.overflow", { slot });
      if (s.outsideSlide)
        add(slot, "outside_slide", "templates.renderIssues.outsideSlide", { slot });
      else if (s.outsideSafe)
        add(slot, "outside_safe_zone", "templates.renderIssues.outsideSafeZone", { slot });
      if (lim.maxLines && s.lines > lim.maxLines)
        add(slot, "too_many_lines", "templates.renderIssues.tooManyLines", {
          slot,
          lines: s.lines,
          max: lim.maxLines,
        });
      if (language) {
        const pct = narrowTextPercent(s);
        if (pct !== null)
          add(slot, "narrow_text", "templates.renderIssues.narrowText", { slot, percent: pct });
      }
      if (language)
        for (const p of typographyProblems(s, language)) {
          if (p.kind === "widow")
            add(slot, "widow", "templates.renderIssues.widow", { slot, line: p.line });
          else if (p.kind === "bad_line_end")
            add(slot, "bad_line_end", "templates.renderIssues.badLineEnd", {
              slot,
              line: p.line,
              word: p.word,
            });
          else if (p.kind === "small_font")
            add(slot, "small_font", "templates.renderIssues.smallFont", {
              slot,
              px: p.px,
              min: MIN_FONT_PX,
            });
          else
            add(slot, "dense_block", "templates.renderIssues.denseBlock", {
              slot,
              lines: p.lines,
              max: MAX_BLOCK_LINES,
            });
        }
    } else {
      if (!s.naturalWidth)
        add(slot, "image_missing", "templates.renderIssues.imageMissing", { slot });
      else if (
        (lim.minWidth && s.naturalWidth < lim.minWidth) ||
        (lim.minHeight && s.naturalHeight < lim.minHeight)
      )
        add(slot, "low_resolution", "templates.renderIssues.lowResolution", {
          slot,
          width: s.naturalWidth,
          height: s.naturalHeight,
        });
    }
  }
  const texts = slots.filter((s) => s.kind === "text");
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++)
      if (intersects(texts[i]!.rect, texts[j]!.rect))
        add(texts[i]!.name, "overlap", "templates.renderIssues.overlap", {
          slot: texts[i]!.name,
          other: texts[j]!.name,
        });
  return issues;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
    );
  });
}

/**
 * Photograph slides at their exact pixel size. One browser context per call, network
 * blocked: a slide is a self-contained document of inline CSS and data: URLs.
 */
export async function captureSlides(
  browser: Browser,
  inputs: CaptureInput[],
  onSlide?: (index: number) => Promise<void> | void,
  /** BCP 47 tag of the deliverable's language (en-GB, it-IT). */
  locale = "en-GB",
): Promise<Capture[]> {
  const first = inputs[0];
  if (!first) return [];
  const context = await browser.newContext({
    viewport: { width: first.rendered.width, height: first.rendered.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    // Same locale as the slide copy (English by default).
    locale,
    timezoneId: "UTC",
    javaScriptEnabled: true,
  });
  try {
    await context.route(/^(?!data:|about:)/, (route) => route.abort());
    const page = await context.newPage();
    const out: Capture[] = [];
    for (const [i, input] of inputs.entries()) {
      const { rendered } = input;
      await page.setViewportSize({ width: rendered.width, height: rendered.height });
      await page.setContent(rendered.html, { waitUntil: "load" });
      await settle(page);
      const slots = await page.evaluate(measureInPage, input.safeZone);
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: rendered.width, height: rendered.height },
        animations: "disabled",
        caret: "hide",
        scale: "css",
      });
      out.push({
        png: new Uint8Array(png),
        slots,
        issues: issuesFromMeasures(i, slots, input.limits, input.language),
      });
      await onSlide?.(i);
    }
    return out;
  } finally {
    await context.close();
  }
}
