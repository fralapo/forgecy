import { describe, expect, it } from "vitest";
import {
  contrastMatrix,
  defaultTokens,
  hexToDtcg,
  referenceColors,
  removedTokenPaths,
  tokenNameFrom,
  tokenRoleNames,
  tokensToCssVars,
  validateTokens,
} from "../src/tokens";

describe("client tokens", () => {
  it("default tokens resolve on all three levels", () => {
    const t = defaultTokens();
    expect(validateTokens(t)).toEqual([]);
    const css = tokensToCssVars(t);
    expect(css["--brand-component-cta-background"]).toBe("#1A1A1A");
    expect(css["--brand-color-semantic-background"]).toBe("#FFFFFF");
    expect(css["--brand-font-family-display"]).toBe("sans-serif");
    expect(tokenRoleNames(t)).toContain("component.cover.title");
    expect(tokenRoleNames(t).some((n) => n.startsWith("color.reference"))).toBe(false);
  });

  it("reports broken aliases and missing roles", () => {
    const t = defaultTokens() as { color: { semantic: Record<string, unknown> } };
    t.color.semantic.background = { $value: "{color.reference.nope}" };
    delete t.color.semantic.accent;
    const issues = validateTokens(t);
    expect(issues.some((i) => i.path === "color.semantic.background")).toBe(true);
    expect(issues.some((i) => i.path === "color.semantic.accent" && /mancante/.test(i.message))).toBe(true);
  });

  it("grades contrast pairs with the WCAG thresholds", () => {
    const t = defaultTokens() as { color: { reference: Record<string, unknown>; semantic: Record<string, unknown> } };
    t.color.reference.giallo = { $value: hexToDtcg("#FFE600") };
    t.color.semantic["text-secondary"] = { $value: "{color.reference.giallo}" };
    const m = contrastMatrix(t);
    expect(m.find((c) => c.label === "Testo su sfondo")?.grade).toBe("normal");
    expect(m.find((c) => c.label === "Testo secondario su sfondo")?.grade).toBe("fail");
    expect(referenceColors(t).map((c) => c.name)).toContain("giallo");
  });

  it("lists removed token paths and builds token names", () => {
    const a = defaultTokens();
    const b = defaultTokens() as { component: Record<string, unknown> };
    delete b.component.progress;
    expect(removedTokenPaths(a, b)).toEqual(["component.progress.active"]);
    expect(tokenNameFrom("Blu Rossi è", "x")).toBe("blu-rossi-e");
    expect(tokenNameFrom("###", "colore-1")).toBe("colore-1");
  });
});
