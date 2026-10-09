/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { MessageRef } from "@forgecy/core";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import type { Browser, Page } from "playwright-core";
import type { RenderedSlide } from "../renderer";
import type { SafeZone } from "../formats";

/** Problems seen on the rendered page (spec: Brand Guard checks on the render, not only the JSON). */
export type RenderIssueKind =
  | "overflow"
  | "outside_slide"
  | "outside_safe_zone"
  | "overlap"
  | "too_many_lines"
  | "low_resolution"
  | "image_missing";

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
}

export interface CaptureInput {
  rendered: RenderedSlide;
  safeZone: SafeZone;
  /** Slot limits used to turn measures into issues. */
  limits?: Record<string, { maxLines?: number; minWidth?: number; minHeight?: number }>;
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
    if (!isImg) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set<number>();
      for (const rect of Array.from(range.getClientRects()))
        if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top));
      lines = tops.size;
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
        issues: issuesFromMeasures(i, slots, input.limits),
      });
      await onSlide?.(i);
    }
    return out;
  } finally {
    await context.close();
  }
}
