import type { MessageRef } from "@forgecy/core";

// Texts the Brand import writes in English: page locators (stable ids the AI cites back),
// color contexts, and reasons stored before their reference columns existed. They are
// recognized here and shown in the reader's language; anything else stays as written.

const ref = (key: string, values?: Record<string, string | number>): MessageRef =>
  values ? { key: `brand.import.${key}`, values } : { key: `brand.import.${key}` };

const fixed: Record<string, MessageRef> = {
  "Document theme": ref("locators.theme"),
  "Start of document": ref("locators.documentStart"),
  "SVG file": ref("locators.svg"),
  Start: ref("locators.start"),
  Note: ref("locators.note"),
  "Color used in the slides": ref("quotes.slideColor"),
  "Color used in the drawing": ref("quotes.drawingColor"),
  "Imported font: confirm role and license.": ref("rationale.fontImported"),
  "Font named in the document theme.": ref("rationale.fontTheme"),
  "Imported logo file: confirm the variant's role.": ref("rationale.logo"),
  "The field changed after the proposal": ref("stale.fieldChanged"),
  "The proposal's source was removed": ref("stale.sourceRemoved"),
};

const patterns: Array<[RegExp, (m: RegExpExecArray) => MessageRef]> = [
  [/^Section (\d+): ([\s\S]*)$/, (m) => ref("locators.section", { number: m[1]!, title: m[2]! })],
  [/^Section: ([\s\S]*)$/, (m) => ref("locators.sectionNamed", { title: m[1]! })],
  [/^Slide (\d+)$/, (m) => ref("locators.slide", { number: m[1]! })],
  [/^p\. (\d+)$/, (m) => ref("locators.page", { number: m[1]! })],
  [/^Theme color (\w+)$/, (m) => ref("quotes.themeColor", { slot: m[1]! })],
  [
    /^Color found in the file \((\d+) occurrences?\)\.$/,
    (m) => ref("rationale.color", { count: Number(m[1]) }),
  ],
  [/^Draft v(\d+) was replaced by a restore$/, (m) => ref("stale.restored", { number: m[1]! })],
  [/^Color (\S+) (#[0-9A-F]{6})$/i, (m) => ref("colorTitle", { name: m[1]!, hex: m[2]! })],
];

/** The reference of an English text written by the Brand import, when it is one. */
export function importTextRef(text: string | null | undefined): MessageRef | undefined {
  if (!text) return undefined;
  const hit = fixed[text];
  if (hit) return hit;
  for (const [re, make] of patterns) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  return undefined;
}
