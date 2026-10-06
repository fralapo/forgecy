import { ForgecyError } from "@forgecy/core";
import { parseHTML } from "linkedom";
import { type BrandTheme, NEUTRAL_BRAND } from "./brand";
import { fontFaceRule, fontStack, inlineCss, resolvePackagePath } from "./css";
import { FORMATS } from "./formats";
import { type TemplatePackage, packageFileDataUrl, readText } from "./package";
import { ALLOWED_ELEMENTS, isAllowedAttribute, isDangerousValue } from "./sanitize";
import type { ImageRef, Slide, SlotValue } from "./slide-schema";
import { type LayoutDef, effectiveSafeZone, findLayout } from "./template-schema";

/** Data URLs for storage keys used by the slide (images, logo, brand fonts), resolved beforehand. */
export type ResolvedAssets = ReadonlyMap<string, string>;

export interface RenderOptions {
  /** Diagonal "Draft" watermark at 20% opacity (export before approval). */
  watermark?: string;
  /** Editor and template editor aids; never used for a final export. */
  showSafeZone?: boolean;
  showSlotOutlines?: boolean;
}

export interface RenderSlideInput {
  pkg: TemplatePackage;
  slide: Slide;
  /** 0-based position and carousel length, for page numbers. */
  index?: number;
  total?: number;
  brand?: BrandTheme;
  assets?: ResolvedAssets;
  options?: RenderOptions;
}

export interface RenderedSlide {
  html: string;
  width: number;
  height: number;
  /** Non-blocking problems, e.g. an image whose asset could not be resolved. */
  warnings: string[];
}

/** Same policy as the HTTP header of the /render route: nothing but inline styles and data: URLs. */
export const RENDER_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
body{width:var(--fc-width);height:var(--fc-height);overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal}
.fc-slide{position:relative;width:var(--fc-width);height:var(--fc-height);overflow:hidden}
[data-slot]{white-space:pre-line;overflow-wrap:break-word}
img[data-slot],img[data-fc]{display:block;object-fit:cover}
[data-empty]{display:none!important}

:where(mark.fc-hl){background:none;color:inherit}`;

const OVERLAY_CSS = `.fc-safe{position:absolute;pointer-events:none;inset:var(--fc-safe-top) var(--fc-safe-right) var(--fc-safe-bottom) var(--fc-safe-left);outline:2px dashed rgba(236,72,153,.85);z-index:2147483000}
.fc-outline [data-slot]{outline:2px solid rgba(59,130,246,.8);outline-offset:-2px;position:relative}
.fc-outline [data-slot]::after{content:attr(data-slot-label);position:absolute;left:0;top:0;transform:translateY(-100%);font:600 18px/1.4 system-ui,sans-serif;color:#fff;background:rgba(59,130,246,.9);padding:0 6px;white-space:nowrap}
.fc-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2147483001}
.fc-watermark span{transform:rotate(-30deg);font:800 260px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--fc-watermark-color,#000);opacity:.2}`;

type Doc = ReturnType<typeof parseHTML>["document"];
type El = ReturnType<Doc["createElement"]>;

/** Insert `text` as text nodes; `==x==` becomes `<mark class="fc-hl">x</mark>` when allowed. */
function setText(doc: Doc, el: El, text: string, highlight: boolean): void {
  el.textContent = "";
  if (!highlight || !text.includes("==")) {
    el.textContent = text;
    return;
  }
  text.split("==").forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const mark = doc.createElement("mark");
      mark.setAttribute("class", "fc-hl");
      mark.textContent = part;
      el.appendChild(mark);
    } else el.appendChild(doc.createTextNode(part));
  });
}

function sanitize(root: El, pkg: TemplatePackage, layoutPath: string): void {
  for (const el of [...root.querySelectorAll("*")] as El[]) {
    const tag = el.localName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const { name, value } = attr;
      if (!isAllowedAttribute(name) || isDangerousValue(name, value)) {
        el.removeAttribute(name);
        continue;
      }
      if (name.toLowerCase() === "src") {
        // Decorative images of the package only; slot images are set later.
        const p = resolvePackagePath(layoutPath, value);
        const data = p ? packageFileDataUrl(pkg, p) : undefined;
        if (data) el.setAttribute("src", data);
        else el.removeAttribute("src");
      }
    }
  }
}

function imageSrc(ref: ImageRef, pkg: TemplatePackage, assets: ResolvedAssets): string | undefined {
  if (ref.asset) return packageFileDataUrl(pkg, ref.asset);
  return ref.key ? assets.get(ref.key) : undefined;
}

function setImage(el: El, ref: ImageRef, src: string | undefined): boolean {
  if (!src) return false;
  el.setAttribute("src", src);
  el.setAttribute("alt", ref.alt);
  const pos = `${Math.round(ref.focalX * 100)}% ${Math.round(ref.focalY * 100)}%`;
  el.setAttribute("style", `${el.getAttribute("style") ?? ""};object-position:${pos}`);
  return true;
}

function fillSlots(
  doc: Doc,
  root: El,
  layout: LayoutDef,
  slide: Slide,
  pkg: TemplatePackage,
  assets: ResolvedAssets,
  warnings: string[],
): void {
  const defs = new Map(layout.slots.map((s) => [s.name, s]));
  for (const el of [...root.querySelectorAll("[data-slot]")] as El[]) {
    const name = el.getAttribute("data-slot") ?? "";
    const def = defs.get(name);
    const value: SlotValue | undefined = slide.slots[name];
    let filled = false;
    if (def?.type === "text" && typeof value === "string" && value.trim()) {
      setText(doc, el, value, def.highlight);
      el.setAttribute("data-slot-label", `${name} · ${def.maxChars}`);
      filled = true;
    } else if (def?.type === "list" && Array.isArray(value) && value.length) {
      const proto = (el.querySelector("li") ?? el.firstElementChild) as El | null;
      el.textContent = "";
      for (const item of value) {
        const li = (proto ? proto.cloneNode(true) : doc.createElement("li")) as El;
        const target = (li.querySelector("[data-item]") ?? li) as El;
        setText(doc, target, item, def.highlight);
        el.appendChild(li);
      }
      el.setAttribute("data-slot-label", `${name} · ${def.maxItems}×${def.maxChars}`);
      el.setAttribute("data-count", String(value.length));
      filled = true;
    } else if (
      def?.type === "image" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      filled = setImage(el, value, imageSrc(value, pkg, assets));
      if (!filled) warnings.push(`Image not available for slot "${name}"`);
      el.setAttribute("data-slot-label", name);
    }
    if (!filled) {
      if (def?.type !== "image") el.textContent = "";
      el.removeAttribute("src");
      el.setAttribute("data-empty", "");
    }
  }
}

function fillAuto(
  root: El,
  pkg: TemplatePackage,
  brand: BrandTheme,
  assets: ResolvedAssets,
  index: number,
  total: number,
): void {
  const rules = pkg.manifest.rules;
  for (const el of [...root.querySelectorAll("[data-fc]")] as El[]) {
    const kind = el.getAttribute("data-fc");
    let text: string | undefined;
    if (kind === "page" && rules.pageNumbers) text = String(index + 1).padStart(2, "0");
    else if (kind === "total" && rules.pageNumbers) text = String(total).padStart(2, "0");
    else if (kind === "brand-name" && brand.name) text = brand.name;
    else if (kind === "handle" && brand.handle) text = brand.handle;
    else if (kind === "logo" && brand.logo) {
      if (setImage(el, brand.logo, imageSrc(brand.logo, pkg, assets))) continue;
    }
    if (text !== undefined) el.textContent = text;
    else {
      if (el.localName !== "img") el.textContent = "";
      el.setAttribute("data-empty", "");
    }
  }
}

function buildCss(
  pkg: TemplatePackage,
  layout: LayoutDef,
  brand: BrandTheme,
  assets: ResolvedAssets,
): string {
  const m = pkg.manifest;
  const out: string[] = [];
  for (const f of m.fonts) {
    const src = packageFileDataUrl(pkg, f.file);
    if (src) out.push(fontFaceRule(f.family, src, f.weight, f.style));
  }
  for (const font of Object.values(brand.fonts)) {
    const src = font?.key ? assets.get(font.key) : undefined;
    if (font && src) out.push(fontFaceRule(font.family, src, font.weight, font.style));
  }
  const safe = effectiveSafeZone(m, layout);
  const vars: string[] = [
    `--fc-width:${m.width}px`,
    `--fc-height:${m.height}px`,
    `--fc-safe-top:${safe.top}px`,
    `--fc-safe-right:${safe.right}px`,
    `--fc-safe-bottom:${safe.bottom}px`,
    `--fc-safe-left:${safe.left}px`,
  ];
  for (const [name, { role, fallback }] of Object.entries(m.colorRoles)) {
    vars.push(`${name}:${brand.colors[role] ?? fallback}`);
    if (role === "text.primary")
      vars.push(`--fc-watermark-color:${brand.colors[role] ?? fallback}`);
  }
  for (const [name, { role, fallback }] of Object.entries(m.fontRoles)) {
    vars.push(`${name}:${fontStack(brand.fonts[role]?.family ?? fallback)}`);
  }
  out.push(`:root{${vars.join(";")}}`, BASE_CSS);
  for (const path of m.styles) out.push(inlineCss(readText(pkg, path) ?? "", pkg, path));
  out.push(OVERLAY_CSS);
  return out.join("\n");
}

/**
 * The SlideRenderer: one function for editor preview, template preview and export.
 * Fills the layout HTML with the slide data as text, applies brand tokens as CSS
 * variables and returns a self-contained HTML document of exactly width×height px.
 * Pure and synchronous: the same input always yields the same string.
 */
export function renderSlideHtml(input: RenderSlideInput): RenderedSlide {
  const { pkg, slide, index = 0, total = 1, options = {} } = input;
  const brand = input.brand ?? NEUTRAL_BRAND;
  const assets = input.assets ?? new Map<string, string>();
  const m = pkg.manifest;
  const layout = findLayout(m, slide.layout);
  if (!layout)
    throw new ForgecyError("validation", `Layout "${slide.layout}" is not in template ${m.id}`);
  const source = readText(pkg, layout.file);
  if (source === undefined)
    throw new ForgecyError("validation", `Layout file missing: ${layout.file}`);

  const warnings: string[] = [];
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body><div class="fc-slide">${source}</div></body></html>`,
  );
  const root = document.querySelector(".fc-slide") as El;
  sanitize(root, pkg, layout.file);
  fillSlots(document, root, layout, slide, pkg, assets, warnings);
  fillAuto(root, pkg, brand, assets, index, total);

  root.setAttribute("data-template", m.id);
  root.setAttribute("data-format", m.format);
  root.setAttribute("data-layout", layout.id);
  root.setAttribute("data-role", layout.role);
  root.setAttribute("data-tone", slide.tone);
  root.setAttribute("data-index", String(index + 1));
  if (index === 0) root.setAttribute("data-first", "");
  if (index === total - 1) root.setAttribute("data-last", "");
  if (options.showSlotOutlines) root.setAttribute("class", "fc-slide fc-outline");
  if (options.showSafeZone) {
    const safe = document.createElement("div");
    safe.setAttribute("class", "fc-safe");
    safe.setAttribute("aria-hidden", "true");
    root.appendChild(safe);
  }
  if (options.watermark) {
    const wm = document.createElement("div");
    wm.setAttribute("class", "fc-watermark");
    wm.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.textContent = options.watermark;
    wm.appendChild(span);
    root.appendChild(wm);
  }

  const css = buildCss(pkg, layout, brand, assets);
  const title = document.createElement("title");
  title.textContent = `${m.name} · ${layout.name} · ${index + 1}`;
  const html =
    // Slide copy is the client's deliverable, Italian by default (not UI text).
    `<!doctype html><html lang="it"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">` +
    `<meta name="viewport" content="width=${m.width}">${title.outerHTML}` +
    `<style>${css}</style></head><body>${root.outerHTML}</body></html>`;
  return { html, width: m.width, height: m.height, warnings };
}

/** Pixel size of a template's slides. */
export function slideSize(pkg: TemplatePackage) {
  const f = FORMATS[pkg.manifest.format];
  return { width: f.width, height: f.height };
}
