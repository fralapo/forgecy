import { describe, expect, it } from "vitest";
import { getTranslator } from "@forgecy/i18n";
import type { MessageRef } from "@forgecy/core";
import { importNotes } from "./import-card";

const say = (locale: "en" | "it", ref: MessageRef | null) =>
  ref
    ? getTranslator(locale, "brand")(ref.key.replace(/^brand\./, "") as never, ref.values as never)
    : null;

describe("import card notes", () => {
  it("says how many items wait for a review, in English and Italian", () => {
    const { kept, undone } = importNotes({ number: 2, needsReview: 3 });
    expect(undone).toBeNull();
    expect(say("en", kept)).toBe("3 kept for review");
    expect(say("it", kept)).toBe("3 da rivedere");
  });

  it("says nothing about the review queue when nothing waits", () => {
    expect(importNotes({ number: 2, needsReview: 0 }).kept).toBeNull();
  });

  it("an undone import says which version restores which, and nothing else", () => {
    const { kept, undone } = importNotes({
      number: 2,
      needsReview: 3,
      undone: { by: 3, restores: 1 },
    });
    expect(kept).toBeNull();
    expect(say("en", undone)).toBe("Automatic import v2 was undone: version v3 restores v1");
    expect(say("it", undone)).toBe(
      "L’importazione automatica v2 è stata annullata: la versione v3 ripristina la v1",
    );
  });
});
