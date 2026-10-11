import type { Locale } from "@forgecy/core";
import { FUNCTION_WORDS } from "./function-words";

const NBSP = "\u00A0";

const patterns = new Map<Locale, RegExp>();
function patternOf(locale: Locale): RegExp {
  let re = patterns.get(locale);
  if (!re) {
    // Same-line spaces only; the lookbehind keeps “dell’” and “a” inside words out.
    re = new RegExp(
      String.raw`(?<![\p{L}\p{N}'’])(${FUNCTION_WORDS[locale].join("|")})[ \t]+(?=\S)`,
      "giu",
    );
    patterns.set(locale, re);
  }
  return re;
}

/**
 * The rendered copy of a slot: a space after a function word becomes a non-breaking
 * space, so a line never ends on “il”, “di”, “the”. Output of the renderer only; the
 * stored text is never changed.
 */
export function bindFunctionWords(text: string, locale: Locale): string {
  return text.replace(patternOf(locale), `$1${NBSP}`);
}
