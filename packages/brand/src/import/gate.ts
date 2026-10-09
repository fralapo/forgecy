/**
 * The deterministic gate that replaces the human review of a website import (ADR 0022): an item
 * is kept only when what it claims can be found in the source. Everything else is discarded and
 * counted, never queued.
 */
import type { SiteProbe } from "@forgecy/audit";
import { normalizeHex } from "../tokens";
import type { CandidateProposal } from "./candidates";
import { cleanFamily, extractedHexes, isFrameworkColor } from "./site-colors";
import { isGenericFont, normalizeText, quoteInPage } from "./verify";

/** A quote shorter than this proves nothing; each part of an ellipsis quote must be at least MIN_SEGMENT. */
export const MIN_QUOTE_CHARS = 12;
export const MIN_QUOTE_SEGMENT = 6;

export type DiscardReason =
  | "quote_not_in_page"
  | "hex_not_extracted"
  | "framework_default"
  | "generic_font"
  | "font_not_extracted";

export interface GateResult {
  keep: CandidateProposal[];
  discarded: Array<{ path: string; reason: DiscardReason }>;
}

const TYPOGRAPHY_PATH = "/document/visual/typography";

type Page = { locator: string; text: string };

const quoteVerified = (text: string, pages: readonly Page[]) =>
  normalizeText(text).length >= MIN_QUOTE_CHARS &&
  pages.some((p) => quoteInPage(text, p.text, { minSegment: MIN_QUOTE_SEGMENT }));

export function gateCandidates(input: {
  candidates: CandidateProposal[];
  pages: readonly Page[];
  visual?: SiteProbe;
}): GateResult {
  const { pages, visual } = input;
  const hexes = extractedHexes(visual);
  const fonts = new Map((visual?.fonts ?? []).map((f) => [cleanFamily(f.family), f]));
  const result: GateResult = { keep: [], discarded: [] };
  const discard = (path: string, reason: DiscardReason) => result.discarded.push({ path, reason });

  for (const c of input.candidates) {
    if (c.kind === "color") {
      // Colors and fonts are checked against what the browser read; their quote, if any, is not evidence.
      const value = c.value as { hex: string };
      const hex = normalizeHex(value.hex)?.toLowerCase();
      const label = `color:${value.hex}`;
      if (!hex || !hexes.has(hex)) discard(label, "hex_not_extracted");
      else if (isFrameworkColor(hex, visual)) discard(label, "framework_default");
      else result.keep.push(c);
      continue;
    }
    if (c.path === TYPOGRAPHY_PATH) {
      const family = (c.value as { family: string }).family;
      const known = fonts.get(cleanFamily(family));
      if (!known) discard(c.path, "font_not_extracted");
      else if (isGenericFont(family) && !known.loaded) discard(c.path, "generic_font");
      else result.keep.push(c);
      continue;
    }
    // Every other item must quote the page it cites; a tone axis also needs a real good example.
    const { quote, locator } = c.evidence;
    const cited = pages.filter((p) => p.locator === locator);
    const example =
      c.path === "/document/verbal/toneAxes"
        ? (c.value as { goodExample: string }).goodExample
        : null;
    if (
      quote !== undefined &&
      (!quoteVerified(quote, cited) || (example !== null && !quoteVerified(example, pages)))
    )
      discard(c.path, "quote_not_in_page");
    else result.keep.push(c);
  }
  return result;
}
