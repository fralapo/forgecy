// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import brandGuard from "./scripts/eslint/brand-guard.js";
import forgecy from "./scripts/eslint/no-hardcoded-text.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "data/**",
      "**/next-env.d.ts",
      "packages/db/migrations/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    // Brand Guard: no hand-written colors or pixel sizes in app and UI code; use the design tokens.
    files: ["apps/web/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "packages/ui/src/tokens.ts", // builds rgb() from the tokens
      "packages/ui/src/generated/**",
    ],
    plugins: { "brand-guard": brandGuard },
    rules: { "brand-guard/no-hand-written-design-values": "error" },
  },
  { files: ["apps/web/**/*.tsx"], plugins: { forgecy } },
  {
    // Interface text lives in packages/i18n/messages (docs/I18N.md). The render routes print
    // deliverables, whose labels come from the template locales instead.
    files: ["apps/web/**/*.tsx"],
    ignores: ["apps/web/app/render/**"],
    rules: { "forgecy/no-hardcoded-text": "error" },
  },
);
