import { describe, expect, it } from "vitest";
import { englishMessage, type MessageKey } from "@forgecy/i18n";
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
];

describe("brand import texts", () => {
  it("recognizes every English text the import writes and rebuilds it from the messages", () => {
    for (const text of written) {
      const ref = importTextRef(text);
      expect(ref, text).toBeDefined();
      expect(englishMessage(ref!.key as MessageKey, ref!.values)).toBe(text);
    }
  });

  it("leaves texts from the document as written", () => {
    expect(importTextRef("Our blue is #0044CC")).toBeUndefined();
  });
});
