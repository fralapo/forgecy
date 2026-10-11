import type { Locale } from "@forgecy/core";

/**
 * Words a line must not end on and that stay glued to the next word (non-breaking space),
 * per deliverable language. Data, not logic: a new language adds a list here.
 */
export const FUNCTION_WORDS: Record<Locale, readonly string[]> = {
  it: [
    ...["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "di", "a", "da", "in"],
    ...["con", "su", "per", "tra", "fra", "e", "o", "ma", "che"],
  ],
  en: [...["a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "and", "or", "but"]],
};
