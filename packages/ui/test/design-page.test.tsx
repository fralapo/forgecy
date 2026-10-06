import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { DesignPage, type DesignPageTexts } from "../src/design-page";

// Texts come from the app's translations; the test only needs placeholders.
const texts: DesignPageTexts = {
  kicker: "kicker",
  title: "title",
  intro: "intro",
  guardAllPass: (count) => `all ${count}`,
  guardSomeFail: (count) => `failed ${count}`,
  ratio: (value) => `${value.toFixed(1)}:1`,
  usage: { text: "text", largeText: "large", decorative: "decorative" },
  colors: {
    title: "colors",
    description: "description",
    onWhite: "white",
    onPorcelain: "porcelain",
  },
  swatch: () => ({}),
  brandGuard: {
    title: "guard",
    description: "description",
    lightCaption: "light",
    darkCaption: "dark",
    pair: "pair",
    colors: "colors",
    contrast: "contrast",
    minimum: "minimum",
    result: "result",
    passed: "passed",
    failed: "failed",
  },
  pairLabel: () => undefined,
  typography: {
    title: "typography",
    description: "description",
    samples: {
      "heading-xl": "a",
      "heading-lg": "b",
      "heading-md": "c",
      "heading-sm": "d",
      "body-lg": "e",
      "body-md": "f",
      "body-sm": "g",
      label: "h",
      "mono-md": "i",
    },
  },
  components: { title: "components", description: "description" },
  darkTheme: { title: "dark", description: "description" },
  showcase: {
    approve: "approve",
    compare: "compare",
    undo: "undo",
    deleteDraft: "delete",
    export: "export",
    publishBlocked: "publish",
    badge: {
      draft: "draft",
      inReview: "review",
      approved: "approved",
      toCheck: "check",
      blocked: "blocked",
      conflict: "conflict",
      new: "new",
    },
    form: {
      title: "form",
      description: "description",
      name: "name",
      namePlaceholder: "placeholder",
      website: "website",
      websiteError: "error",
      create: "create",
      cancel: "cancel",
    },
    proposal: { title: "proposal", body: "body", wcagSource: "wcag" },
  },
  aiProposal: { kicker: "ai", sources: "sources", accept: "accept", reject: "reject" },
};

describe("DesignPage", () => {
  it("renders as a plain function (server-component safe, no hooks)", () => {
    expect(isValidElement(DesignPage({ texts }))).toBe(true);
  });
});
