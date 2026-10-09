import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import plugin from "../eslint/brand-guard.js";
import { read } from "./helpers";

const linter = new Linter({ configType: "flat" });
const lint = (code: string) =>
  linter
    .verify(
      code,
      [
        {
          files: ["**/*.tsx"],
          plugins: { "brand-guard": plugin },
          languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { "brand-guard/no-hand-written-design-values": "error" },
        },
      ],
      "file.tsx",
    )
    .map((m) => m.messageId);

describe("brand-guard/no-hand-written-design-values", () => {
  it.each([
    ['<div className="bg-[#ff0000]" />', "color"],
    ["const c = `rgb(0 0 0 / ${a})`;", "color"],
    ['<p className={"text-[oklch(0.5 0.1 20)]"} />', "color"],
    ['<div className="shadow-[0_1px_2px_rgba(0,0,0,0.2)]" />', "color"],
    ['<div style={{ background: "color-mix(in srgb, red, blue)" }} />', "color"],
    ["<div className={`w-[13px] ${x}`} />", "size"],
    ['<div style={{ width: "13px" }} />', "size"],
    ['<div className="top-[-4px]" />', "size"],
  ])("flags %s", (code, messageId) => {
    expect(lint(code)).toEqual([messageId]);
  });

  it.each([
    '<div className="bg-surface text-fg grid lg:grid-cols-[1fr_22rem]" />',
    "<div style={{ width: `${p}%` }} />",
    "const w = `${n}px`;",
    'const v = "var(--fc-bg)";',
    '<a href="#main">skip</a>',
    'import x from "@forgecy/ui";',
    "<div style={{ transform: `scale(${s})` }} />",
  ])("accepts %s", (code) => {
    expect(lint(code)).toEqual([]);
  });

  it("is wired into eslint.config.js for app and UI code, not only .tsx literals", () => {
    const config = read("eslint.config.js");
    expect(config).toContain("brand-guard/no-hand-written-design-values");
    expect(config).toContain('"apps/web/**/*.{ts,tsx}"');
    expect(config).not.toContain("Literal[value=");
  });
});
