/**
 * What a site really declares, from its stored probe: the colors and fonts that are offered to the
 * analyst, proposed directly, and used by the gate to refuse anything else. Pure.
 */
import type { SiteProbe } from "@forgecy/audit";
import { englishMessage } from "@forgecy/i18n";
import { isFrameworkDefaultHex, isGenericFont } from "./verify";

/** A CSS variable with one of these words in its name is the brand's own choice, even over a framework hex. */
const BRAND_VAR = /primary|secondary|brand|accent|main/i;

/** Evidence locators of what the site's styles gave: English text of an i18n key, translated when shown. */
export const SITE_LOCATORS = {
  styles: englishMessage("brand.import.locators.siteStyles"),
  fonts: englishMessage("brand.import.locators.siteFonts"),
  buttons: englishMessage("brand.import.locators.siteButtons"),
  themeColor: englishMessage("brand.import.locators.siteThemeColor"),
} as const;

export interface KnownColor {
  hex: string;
  /** Token slug: the variable name without `--`, `color-`, `brand-`, or "theme"/"button" for the other sources. */
  name: string;
  /** Where it was read, shown as the proposal's evidence. */
  locator: string;
}

export const cleanFamily = (family: string) =>
  family
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

/** Every opaque color the probe holds, lowercase #rrggbb. */
export function extractedHexes(visual: SiteProbe | undefined): Set<string> {
  const out = new Set<string>();
  if (!visual) return out;
  for (const v of visual.cssVars) out.add(v.hex.toLowerCase());
  if (visual.themeColor) out.add(visual.themeColor.toLowerCase());
  for (const b of visual.buttonColors) out.add(b.hex.toLowerCase());
  return out;
}

/** True for a CSS-framework default palette color the site did not declare as its brand variable. */
export function isFrameworkColor(hex: string, visual: SiteProbe | undefined): boolean {
  if (!isFrameworkDefaultHex(hex)) return false;
  const h = hex.toLowerCase();
  return !visual?.cssVars.some((v) => v.hex.toLowerCase() === h && BRAND_VAR.test(v.name));
}

/** Role words in a variable's name, strongest first; text and background name the neutrals. */
const ROLE_WORDS = ["primary", "secondary", "accent", "brand", "main", "text", "background"];
/** Page-builder globals (Elementor's kit): what the site's owner picked, even under a code name. */
const BUILDER_GLOBAL = /^--e-global-color-/i;

/** Nearly no hue (grays, off-whites): chroma guards the near-white/near-black where HSL saturation jumps. */
export function isNeutral(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return max - min < 0.08 || saturation < 0.12;
}

const lightness = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (Math.max(...c) + Math.min(...c)) / 510;
};

/**
 * Every color the site declares, best first: `theme-color`, variables named for a role
 * (primary, secondary, accent... in that order), button colors by weight, the page builder's
 * other globals, then the remaining variables. Exact duplicates and framework defaults are out.
 */
function rankedColors(visual: SiteProbe): KnownColor[] {
  const ranked: Array<KnownColor & { rank: number }> = [];
  const roleOf = (name: string) => {
    const i = ROLE_WORDS.findIndex((w) => name.toLowerCase().includes(w));
    return i < 0 ? ROLE_WORDS.length : i;
  };
  if (visual.themeColor)
    ranked.push({
      hex: visual.themeColor,
      name: "theme",
      locator: SITE_LOCATORS.themeColor,
      rank: 0,
    });
  for (const v of visual.cssVars) {
    const role = roleOf(v.name);
    const name =
      v.name
        .replace(/^--/, "")
        .replace(/^(?:e-global-color-|wp--preset--color--|color-|brand-)+/i, "") || v.name;
    ranked.push({
      hex: v.hex,
      name,
      locator: v.name,
      rank: role < ROLE_WORDS.length ? 1 + role / 10 : BUILDER_GLOBAL.test(v.name) ? 3 : 4,
    });
  }
  // Already sorted by weight (buildSiteProbe), but a stored probe is not trusted to be.
  [...visual.buttonColors]
    .sort((a, c) => c.weight - a.weight)
    .forEach((b, i) =>
      ranked.push({
        hex: b.hex,
        name: b.role === "bg" ? "button" : "button-text",
        locator: SITE_LOCATORS.buttons,
        rank: 2 + i / 1000,
      }),
    );
  const out: KnownColor[] = [];
  const seen = new Set<string>();
  for (const { hex, name, locator } of ranked.sort((a, b) => a.rank - b.rank)) {
    const h = hex.toLowerCase();
    if (seen.has(h) || isFrameworkColor(h, visual)) continue;
    seen.add(h);
    out.push({ hex: h, name, locator });
  }
  return out;
}

/**
 * The palette the site really uses, at most `max` colors: the chromatic ones by rank, then at
 * most two neutrals (one light for backgrounds, one dark for text). The rest of a gray ramp
 * says nothing about the brand and is left out.
 */
export function knownColors(visual: SiteProbe, max = Infinity): KnownColor[] {
  const all = rankedColors(visual);
  const light = all.find((c) => isNeutral(c.hex) && lightness(c.hex) >= 0.5);
  const dark = all.find((c) => isNeutral(c.hex) && lightness(c.hex) < 0.5);
  const neutrals = [light, dark].filter((c): c is KnownColor => !!c).slice(0, max);
  const chromatic = all.filter((c) => !isNeutral(c.hex)).slice(0, max - neutrals.length);
  return [...chromatic, ...neutrals];
}

/** Fonts worth proposing: loaded by the page, or not a system/generic family. */
export function knownFonts(visual: SiteProbe): SiteProbe["fonts"] {
  return visual.fonts.filter((f) => f.loaded || !isGenericFont(f.family));
}
