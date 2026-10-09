/// <reference lib="dom" />
// measureBrand runs in the browser (page.evaluate), so this file needs DOM types in any consumer.
import { JSON_LD } from "./fetcher";

export interface ProbeImage {
  url: string;
  alt: string;
  w: number;
  h: number;
  inHeader: boolean;
  inFooter: boolean;
  repeats: number;
  source: "img" | "css-bg" | "og" | "icon" | "jsonld";
}

export type FontRole = "headings" | "body" | "button";

export interface SiteProbe {
  /** :root custom properties that resolve to an opaque color. */
  cssVars: Array<{ name: string; hex: string }>;
  /** From <meta name="theme-color">. */
  themeColor?: string;
  /** Computed on buttons, links and the header. */
  buttonColors: Array<{ hex: string; role: "bg" | "text"; weight: number }>;
  fonts: Array<{ family: string; roles: FontRole[]; loaded: boolean }>;
  /** Ranked best first. */
  logos: ProbeImage[];
  /** Content images, deduped by url. */
  images: ProbeImage[];
  organization?: { name?: string; logo?: string; sameAs: string[]; description?: string };
}

/** What the page reports: raw CSS color strings, normalized and capped by buildSiteProbe. */
export interface RawProbe {
  cssVars: Array<{ name: string; color: string }>;
  themeColor?: string;
  buttonColors: Array<{ color: string; role: "bg" | "text"; weight: number }>;
  fonts: SiteProbe["fonts"];
  /** Unranked logo candidates. */
  logos: ProbeImage[];
  images: ProbeImage[];
}

const MAX_CSS_VARS = 40;
const MAX_BUTTON_COLORS = 24;
const MAX_FONTS = 12;
const MAX_IMAGES = 60;
const MAX_LOGOS = 8;
const MAX_SAME_AS = 20;

const channel = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/** Opaque colors as lowercase #rrggbb; null for transparent, translucent or unparsable ones. */
export function toHex(css: string): string | null {
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (hex) {
    let h = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    if (h.length === 8) {
      if (h.slice(6) !== "ff") return null;
      h = h.slice(0, 6);
    }
    return h.length === 6 ? `#${h}` : null;
  }
  const alpha = (a: string | undefined) =>
    a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    s,
  );
  if (rgb) {
    if (!(alpha(rgb[4]) >= 1)) return null;
    return `#${[rgb[1], rgb[2], rgb[3]].map((v) => channel(Number(v))).join("")}`;
  }
  const hsl =
    /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(
      s,
    );
  if (hsl) {
    if (!(alpha(hsl[4]) >= 1)) return null;
    const h = Number(hsl[1]) % 360;
    const sat = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const a = sat * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return `#${channel(f(0))}${channel(f(8))}${channel(f(4))}`;
  }
  return null;
}

function httpUrl(raw: string, base?: string): string | undefined {
  try {
    const u = new URL(raw.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** The organization the site declares about itself in JSON-LD (first Organization/LocalBusiness). */
export function parseJsonLdOrganization(html: string, baseUrl: string): SiteProbe["organization"] {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 5 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 50).forEach((n) => visit(n, depth + 1));
    const obj = node as Record<string, unknown>;
    nodes.push(obj);
    if (obj["@graph"]) visit(obj["@graph"], depth + 1);
  };
  for (const m of html.matchAll(JSON_LD)) {
    try {
      visit(JSON.parse(m[1]!), 0);
    } catch {
      // Invalid JSON-LD declares nothing.
    }
  }
  const org = nodes.find((n) =>
    [n["@type"]].flat().some((t) => t === "Organization" || t === "LocalBusiness"),
  );
  if (!org) return undefined;

  const byId = new Map<string, Record<string, unknown>>();
  for (const n of nodes) if (typeof n["@id"] === "string") byId.set(n["@id"], n);
  // Yoast and others point the logo at an ImageObject elsewhere in the graph by @id.
  const logoOf = (v: unknown, depth = 0): string | undefined => {
    if (Array.isArray(v)) return logoOf(v[0], depth);
    if (typeof v === "string") {
      const ref = byId.get(v);
      return ref && ref !== org && depth < 2 ? logoOf(ref, depth + 1) : httpUrl(v, baseUrl);
    }
    if (!v || typeof v !== "object" || depth > 2) return undefined;
    const o = v as Record<string, unknown>;
    const direct = str(o.url) ?? str(o.contentUrl);
    if (direct) return httpUrl(direct, baseUrl);
    const ref = typeof o["@id"] === "string" ? byId.get(o["@id"]) : undefined;
    return ref && ref !== o ? logoOf(ref, depth + 1) : undefined;
  };

  const name = str(org.name);
  const logo = logoOf(org.logo);
  const description = str(org.description);
  const sameAs = [
    ...new Set(
      [org.sameAs]
        .flat()
        .map((s) => (typeof s === "string" ? httpUrl(s) : undefined))
        .filter((s): s is string => s !== undefined),
    ),
  ].slice(0, MAX_SAME_AS);
  return {
    ...(name ? { name } : {}),
    ...(logo ? { logo } : {}),
    sameAs,
    ...(description ? { description } : {}),
  };
}

function logoScore(i: ProbeImage): number {
  let score = 0;
  if (i.inHeader) score += 5;
  if (/logo/i.test(i.url) || /logo/i.test(i.alt)) score += 4;
  if (i.source === "jsonld") score += 2;
  if (i.source === "og") score += 1;
  // og, icon and JSON-LD candidates have no measured size (0x0): only a known one can disqualify.
  if (i.w > 0 && i.h > 0 && (i.w > 1200 || i.h > 1200)) score -= 5;
  if (i.inFooter && !i.inHeader) score -= 3;
  return score;
}

/** Best logo candidate first; tracking pixels and images that score 0 or less are dropped. */
export function rankLogoCandidates(images: ProbeImage[]): ProbeImage[] {
  return images
    .filter((i) => !(i.w > 0 && i.h > 0 && i.w * i.h < 64))
    .map((image) => ({ image, score: logoScore(image) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.image);
}

/** Families every machine has: a computed font-family that falls back to one says nothing about the brand. */
const SYSTEM_FONTS = new Set([
  "arial",
  "helvetica",
  "helvetica neue",
  "times",
  "times new roman",
  "georgia",
  "courier",
  "courier new",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "segoe ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "-apple-system",
  "blinkmacsystemfont",
]);

const httpImages = (images: ProbeImage[]): ProbeImage[] =>
  images.flatMap((i) => {
    const url = httpUrl(i.url);
    return url ? [{ ...i, url }] : [];
  });

/** Turns the page's raw report plus its markup into the stored probe. */
export function buildSiteProbe(raw: RawProbe, html: string, baseUrl: string): SiteProbe {
  const cssVars = raw.cssVars.flatMap((v) => {
    const hex = toHex(v.color);
    return hex ? [{ name: v.name, hex }] : [];
  });

  const buttons = new Map<string, { hex: string; role: "bg" | "text"; weight: number }>();
  for (const b of raw.buttonColors) {
    const hex = toHex(b.color);
    if (!hex) continue;
    const key = `${hex}|${b.role}`;
    const prev = buttons.get(key);
    buttons.set(key, { hex, role: b.role, weight: (prev?.weight ?? 0) + b.weight });
  }

  const organization = parseJsonLdOrganization(html, baseUrl);
  const candidates = httpImages(raw.logos);
  if (organization?.logo) {
    const known = candidates.find((c) => c.url === organization.logo);
    if (known) known.source = "jsonld";
    else
      candidates.push({
        url: organization.logo,
        alt: organization.name ?? "",
        w: 0,
        h: 0,
        inHeader: false,
        inFooter: false,
        repeats: 1,
        source: "jsonld",
      });
  }

  const themeColor = raw.themeColor ? toHex(raw.themeColor) : null;
  return {
    cssVars: cssVars.slice(0, MAX_CSS_VARS),
    ...(themeColor ? { themeColor } : {}),
    buttonColors: [...buttons.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_BUTTON_COLORS),
    fonts: raw.fonts
      .filter((f) => f.loaded || !SYSTEM_FONTS.has(f.family.toLowerCase()))
      .slice(0, MAX_FONTS),
    logos: rankLogoCandidates(candidates).slice(0, MAX_LOGOS),
    images: httpImages(raw.images).slice(0, MAX_IMAGES),
    ...(organization ? { organization } : {}),
  };
}

/**
 * Runs in the page: reads what the site really uses (custom properties, computed button
 * colors, loaded fonts, images with their on-screen size). Self-contained on purpose: only
 * this function's source is sent to the browser. One unreadable element is skipped, never fatal.
 */
export function measureBrand(): RawProbe {
  const root = document.documentElement;
  const abs = (u: string | null | undefined): string => {
    try {
      return u ? new URL(u, document.baseURI).href : "";
    } catch {
      return "";
    }
  };
  const unquote = (s: string) => s.replace(/["']/g, "").trim();

  // Custom properties declared on :root/html, resolved to a computed rgb() by a scratch element.
  const names = new Set<string>();
  const walk = (rules: CSSRuleList, depth: number): void => {
    for (const rule of Array.from(rules)) {
      if (names.size >= 400) return;
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.split(",").some((s) => /^\s*(:root|html)\s*$/i.test(s)))
          for (const prop of Array.from(rule.style)) if (prop.startsWith("--")) names.add(prop);
      } else if (depth < 2 && "cssRules" in rule) {
        walk((rule as CSSGroupingRule).cssRules, depth + 1);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, 0);
    } catch {
      // Cross-origin stylesheet: its rules are not readable.
    }
  }
  const scratch = document.createElement("span");
  scratch.style.display = "none";
  root.appendChild(scratch);
  const cssVars: RawProbe["cssVars"] = [];
  const rootStyle = getComputedStyle(root);
  for (const name of names) {
    try {
      const value = rootStyle.getPropertyValue(name).trim();
      if (!value || /^(currentcolor|inherit|initial|unset|revert)/i.test(value)) continue;
      if (!CSS.supports("color", value)) continue;
      scratch.style.color = "";
      scratch.style.color = value;
      cssVars.push({ name, color: getComputedStyle(scratch).color });
    } catch {
      // Skip this property.
    }
  }
  scratch.remove();

  const buttonColors: RawProbe["buttonColors"] = [];
  const targets = document.querySelectorAll(
    "a.button, .btn, button, [class*=button], header, nav a",
  );
  for (const el of Array.from(targets).slice(0, 40)) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const weight = Math.round(Math.min(rect.width * rect.height, 200000));
      buttonColors.push({ color: style.backgroundColor, role: "bg", weight });
      buttonColors.push({ color: style.color, role: "text", weight });
    } catch {
      // Skip this element.
    }
  }

  const loaded = new Set<string>();
  document.fonts.forEach((face) => {
    if (face.status === "loaded") loaded.add(unquote(face.family).toLowerCase());
  });
  const roleSelectors: Array<[string, "headings" | "body" | "button"]> = [
    ["h1", "headings"],
    ["h2", "headings"],
    ["body", "body"],
    ["button, .btn, a.button", "button"],
  ];
  const fonts = new Map<string, Set<"headings" | "body" | "button">>();
  for (const [selector, role] of roleSelectors) {
    try {
      const el = document.querySelector(selector);
      if (!el) continue;
      const family = unquote(getComputedStyle(el).fontFamily.split(",")[0] ?? "");
      if (!family) continue;
      fonts.set(family, (fonts.get(family) ?? new Set()).add(role));
    } catch {
      // Skip this role.
    }
  }

  const images = new Map<string, ProbeImage>();
  const extra = new Map<string, ProbeImage>();
  const add = (map: Map<string, ProbeImage>, image: ProbeImage) => {
    const prev = map.get(image.url);
    if (!prev) return void map.set(image.url, image);
    prev.repeats += 1;
    prev.inHeader ||= image.inHeader;
    prev.inFooter ||= image.inFooter;
    if (image.w * image.h > prev.w * prev.h) {
      prev.w = image.w;
      prev.h = image.h;
    }
  };
  for (const img of Array.from(document.images).slice(0, 400)) {
    try {
      let url = img.currentSrc || img.src;
      // Lazy-loaders leave a data: placeholder in src and the real address in a data attribute.
      if (!url || url.startsWith("data:"))
        url = abs(img.getAttribute("data-src") || img.getAttribute("data-lazy-src")) || url;
      if (!url) continue;
      const rect = img.getBoundingClientRect();
      add(images, {
        url: abs(url),
        alt: img.alt.trim(),
        w: Math.round(rect.width || img.naturalWidth),
        h: Math.round(rect.height || img.naturalHeight),
        inHeader: img.closest("header, nav, [role=banner]") !== null,
        inFooter: img.closest("footer, [role=contentinfo]") !== null,
        repeats: 1,
        source: "img",
      });
    } catch {
      // Skip this image.
    }
  }

  // Logos drawn as CSS backgrounds: on a "logo" element or on the link back to the home page.
  for (const el of Array.from(
    document.querySelectorAll('[class*=logo], [id*=logo], a[rel=home], header a[href="/"]'),
  ).slice(0, 100)) {
    try {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage);
      const url = abs(m?.[1]);
      if (!url) continue;
      const rect = el.getBoundingClientRect();
      add(extra, {
        url,
        alt: el.getAttribute("aria-label")?.trim() ?? "",
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        inHeader: el.closest("header, nav, [role=banner]") !== null,
        inFooter: el.closest("footer, [role=contentinfo]") !== null,
        repeats: 1,
        source: "css-bg",
      });
    } catch {
      // Skip this element.
    }
  }
  for (const link of Array.from(
    document.querySelectorAll("link[rel~=icon], link[rel=apple-touch-icon]"),
  )) {
    const url = abs(link.getAttribute("href"));
    if (!url) continue;
    const size = /^(\d+)x(\d+)$/.exec(link.getAttribute("sizes") ?? "");
    add(extra, {
      url,
      alt: "",
      w: Number(size?.[1] ?? 0),
      h: Number(size?.[2] ?? 0),
      inHeader: false,
      inFooter: false,
      repeats: 1,
      source: "icon",
    });
  }
  const og = abs(document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
  if (og)
    add(extra, {
      url: og,
      alt: "",
      w: 0,
      h: 0,
      inHeader: false,
      inFooter: false,
      repeats: 1,
      source: "og",
    });

  const allImages = [...images.values()];
  const themeColor = document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
  return {
    cssVars,
    ...(themeColor ? { themeColor } : {}),
    buttonColors,
    fonts: Array.from(fonts, ([family, roles]) => ({
      family,
      roles: [...roles],
      loaded: loaded.has(family.toLowerCase()),
    })),
    logos: [
      ...allImages.filter((i) => i.inHeader || /logo/i.test(`${i.url} ${i.alt}`)),
      ...extra.values(),
    ],
    images: allImages.sort((a, b) => b.w * b.h - a.w * a.h),
  };
}
