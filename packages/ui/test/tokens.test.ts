import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import tokensJson from "../tokens/forgecy.tokens.json";
import {
  buildTokensCss,
  flattenTokens,
  resolveValue,
  tokenCssVar,
  tokenHex,
  type TokenTree,
} from "../src/tokens";

const tree = tokensJson as unknown as TokenTree;
const tokens = flattenTokens(tree);

describe("alias resolution", () => {
  it("resolves semantic aliases to reference colors", () => {
    expect(tokenHex(tokens, "semantic.light.bg.app")).toBe("#F6F4EF");
    expect(tokenHex(tokens, "semantic.light.text.link")).toBe("#1646D8");
    expect(tokenHex(tokens, "semantic.dark.text.link")).toBe("#7A9BFF");
    expect(tokenHex(tokens, "semantic.dark.bg.app")).toBe("#171821");
  });

  it("inherits $type from parent groups", () => {
    expect(tokens.get("color.forge-blue")?.type).toBe("color");
    expect(tokens.get("semantic.light.bg.app")?.type).toBe("color");
    expect(tokens.get("font.scale.heading-xl")?.type).toBe("typography");
  });

  it("resolves aliases nested inside composite values", () => {
    const v = resolveValue(tokens, "font.scale.heading-xl") as {
      fontFamily: string[];
      fontSize: { value: number };
    };
    expect(v.fontFamily.slice(0, 2)).toEqual(["Space Grotesk Variable", "Space Grotesk"]);
    expect(v.fontSize.value).toBe(48);
  });

  it("follows alias chains and rejects cycles and unknown refs", () => {
    const chain = flattenTokens({
      a: { $type: "color", $value: "#245BFF" },
      b: { $value: "{a}" },
      c: { $value: "{b}" },
    });
    expect(tokenHex(chain, "c")).toBe("#245BFF");
    const loop = flattenTokens({ a: { $value: "{b}" }, b: { $value: "{a}" } });
    expect(() => resolveValue(loop, "a")).toThrow(/Circular/);
    const missing = flattenTokens({ a: { $value: "{nope}" } });
    expect(() => resolveValue(missing, "a")).toThrow(/Unknown token/);
  });

  it("has the same semantic token set in light and dark", () => {
    const rel = (theme: string) =>
      [...tokens.keys()]
        .filter((p) => p.startsWith(`semantic.${theme}.`))
        .map((p) => p.replace(`semantic.${theme}.`, ""))
        .sort();
    expect(rel("dark")).toEqual(rel("light"));
  });

  it("maps paths to --fc- variables", () => {
    expect(tokenCssVar("semantic.light.action.primary.bg")).toBe("--fc-action-primary-bg");
    expect(tokenCssVar("font.family.display")).toBe("--fc-font-display");
    expect(tokenCssVar("color.forge-blue-700")).toBe("--fc-color-forge-blue-700");
  });
});

describe("generated CSS", () => {
  const css = buildTokensCss(tree);

  it("is deterministic and matches the checked-in file", () => {
    expect(buildTokensCss(tree)).toBe(css);
    const checkedIn = readFileSync(new URL("../src/generated/tokens.css", import.meta.url), "utf8");
    expect(checkedIn, "run `pnpm tokens`").toBe(css);
  });

  it.each([
    "--fc-color-forge-blue: #245BFF;",
    "--fc-bg-app: var(--fc-color-porcelain);",
    "--fc-text-primary: var(--fc-color-graphite-900);",
    "--fc-focus-ring: var(--fc-color-forge-blue);",
    "--fc-radius-md: 8px;",
    "--fc-space-24: 24px;",
    "--fc-line-hairline: 1px;",
    "--fc-motion-fast: 120ms;",
    "--fc-motion-base: 200ms;",
    '--fc-font-display: "Space Grotesk Variable", "Space Grotesk", ui-sans-serif, system-ui, sans-serif;',
    '--fc-font-body: "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif;',
    "--fc-text-heading-xl-size: 3rem;",
    "--fc-text-heading-xl-letter-spacing: -0.03em;",
    "--fc-text-label-letter-spacing: 0.03em;",
    "--fc-shadow-modal: 0px 16px 40px 0px rgb(23 24 33 / 0.18);",
  ])("contains %s", (decl) => {
    expect(css).toContain(decl);
  });

  it("contains a dark theme block", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'));
    expect(dark).toContain("--fc-bg-surface: var(--fc-color-dark-graphite-800);");
    expect(dark).toContain("--fc-text-secondary: var(--fc-color-dark-graphite-30);");
  });

  it("maps shadcn/ui variables", () => {
    for (const decl of [
      "--background: var(--fc-bg-app);",
      "--foreground: var(--fc-text-primary);",
      "--card: var(--fc-bg-surface);",
      "--primary: var(--fc-action-primary-bg);",
      "--primary-foreground: var(--fc-action-primary-text);",
      "--muted-foreground: var(--fc-text-secondary);",
      "--destructive: var(--fc-action-danger-bg);",
      "--border: var(--fc-border-subtle);",
      "--input: var(--fc-border-control);",
      "--ring: var(--fc-focus-ring);",
    ]) {
      expect(css).toContain(decl);
    }
  });

  it("emits a Tailwind 4 @theme inline block with semantic utilities", () => {
    const theme = css.slice(css.indexOf("@theme inline {"));
    for (const decl of [
      "--color-*: initial;",
      "--color-app: var(--fc-bg-app);",
      "--color-surface: var(--fc-bg-surface);",
      "--color-fg: var(--fc-text-primary);",
      "--color-fg-muted: var(--fc-text-secondary);",
      "--color-primary: var(--primary);",
      "--color-ring: var(--ring);",
      "--font-display: var(--fc-font-display);",
      "--text-heading-xl: var(--fc-text-heading-xl-size);",
      "--text-heading-xl--line-height: var(--fc-text-heading-xl-line-height);",
      "--radius-md: var(--fc-radius-md);",
      "--shadow-dropdown: var(--fc-shadow-dropdown);",
    ]) {
      expect(theme).toContain(decl);
    }
    // No raw colors in the utility layer: everything points at a variable.
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("fails on broken aliases", () => {
    expect(() =>
      buildTokensCss({
        semantic: { light: { x: { $type: "color", $value: "{missing}" } }, dark: {} },
      }),
    ).toThrow();
  });
});
