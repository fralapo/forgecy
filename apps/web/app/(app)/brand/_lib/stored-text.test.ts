import { describe, expect, it } from "vitest";
import { englishMessage, getTranslator, type MessageKey } from "@forgecy/i18n";
import { importTextRef } from "./stored-text";

// Texts exactly as packages/brand writes them (locators are ids the AI cites back).
const written = [
  "Document theme",
  "Start of document",
  "Section 2: Our values",
  "Section: Tone",
  "Slide 3",
  "p. 12",
  "SVG file",
  "Start",
  "Note",
  "Site styles",
  "Site fonts",
  "Buttons and links",
  "Site theme color",
  "Profile",
  "Theme color accent1",
  "Color used in the slides",
  "Color used in the drawing",
  "Color found in the file (1 occurrence).",
  "Color found in the file (4 occurrences).",
  "Imported font: confirm role and license.",
  "Font named in the document theme.",
  "Imported logo file: confirm the variant's role.",
  "The field changed after the proposal",
  "Draft v3 was replaced by a restore",
  "The proposal's source was removed",
  "Color theme-color-dk1 #0044CC",
  // Changelog and note of the versions an automatic import publishes (auto-import.ts).
  "Automatic import from www.staging-g.deodue.it, instagram-deodue",
  "Automatic import from public pages",
  "Automatic import",
  "Undo of automatic import v2",
  "Undo of automatic import",
];

describe("brand import texts", () => {
  it("recognizes every English text the import writes and rebuilds it from the messages", () => {
    for (const text of written) {
      const ref = importTextRef(text);
      expect(ref, text).toBeDefined();
      expect(englishMessage(ref!.key as MessageKey, ref!.values)).toBe(text);
    }
  });

  it("shows an automatic import's changelog in Italian", () => {
    const it = getTranslator("it", "brand");
    const show = (text: string) => {
      const r = importTextRef(text)!;
      return it(r.key.replace(/^brand\./, "") as never, r.values as never);
    };
    expect(show("Automatic import from www.staging-g.deodue.it")).toBe(
      "Importazione automatica da www.staging-g.deodue.it",
    );
    expect(show("Undo of automatic import v2")).toBe(
      "Annullamento dell’importazione automatica v2",
    );
    expect(show("Automatic import")).toBe("Importazione automatica");
  });

  it("leaves texts from the document as written", () => {
    expect(importTextRef("Our blue is #0044CC")).toBeUndefined();
  });
});
