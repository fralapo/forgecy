import type { Locale } from "@forgecy/core";
import { FUNCTION_WORDS } from "./function-words";

/** Smallest text on a slide, in px, readable in a feed thumbnail (the smallest step of the type scale). */
export const MIN_FONT_PX = 24;
/** More lines than this in one block reads as a wall of text. */
export const MAX_BLOCK_LINES = 7;
/** A last line this short (one word, at most this many letters) is a widow. */
const WIDOW_MAX_LETTERS = 6;

export type TypographyProblem =
  | { kind: "widow"; line: number }
  | { kind: "bad_line_end"; line: number; word: string }
  | { kind: "small_font"; px: number }
  | { kind: "dense_block"; lines: number };

export interface TypographyInput {
  /** Text of each rendered line, in order. */
  lineTexts?: readonly string[];
  /** Computed font size in px. */
  fontSize?: number;
  lines: number;
}

const clean = (line: string) => line.replace(/\u00A0/g, " ").trim();

/** Problems of the typography of one rendered text block (first widow and first bad end only). */
export function typographyProblems(m: TypographyInput, locale: Locale): TypographyProblem[] {
  const out: TypographyProblem[] = [];
  const lines = (m.lineTexts ?? []).map(clean).filter(Boolean);
  const last = lines.at(-1);
  if (
    lines.length >= 2 &&
    last &&
    !/\s/.test(last) &&
    last.replace(/\P{L}/gu, "").length <= WIDOW_MAX_LETTERS
  )
    out.push({ kind: "widow", line: lines.length });
  const function_ = new Set(FUNCTION_WORDS[locale]);
  for (const [i, line] of lines.slice(0, -1).entries()) {
    const word = line.split(/\s+/).at(-1) ?? "";
    // A word with punctuation after it ends a phrase; it is not left hanging.
    if (function_.has(word.toLowerCase())) {
      out.push({ kind: "bad_line_end", line: i + 1, word });
      break;
    }
  }
  if (m.fontSize !== undefined && m.fontSize > 0 && m.fontSize < MIN_FONT_PX)
    out.push({ kind: "small_font", px: Math.round(m.fontSize) });
  if (m.lines > MAX_BLOCK_LINES) out.push({ kind: "dense_block", lines: m.lines });
  return out;
}
