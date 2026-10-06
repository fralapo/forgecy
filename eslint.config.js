// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
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
    // Brand Guard: no hardcoded colors in app and UI code; use the design tokens.
    files: ["apps/web/**/*.tsx", "packages/ui/src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(|\\bhsla?\\(/]",
          message: "Brand Guard: use @forgecy/ui tokens instead of hand-written colors.",
        },
        {
          selector: "Literal[value=/\\b(bg|text|border|ring|fill|stroke)-\\[#/]",
          message: "Brand Guard: no arbitrary colors in Tailwind, use the tokens.",
        },
      ],
    },
  },
  { files: ["apps/web/**/*.tsx"], plugins: { forgecy } },
  {
    // Interface text lives in packages/i18n/messages (docs/I18N.md). Each module joins this
    // list once its pages read their text from the message files.
    files: [
      "apps/web/app/layout.tsx",
      "apps/web/app/login/**/*.tsx",
      "apps/web/app/setup/**/*.tsx",
      "apps/web/components/**/*.tsx",
      "apps/web/app/(app)/layout.tsx",
      "apps/web/app/(app)/page.tsx",
      "apps/web/app/(app)/clients/**/*.tsx",
      "apps/web/app/(app)/settings/**/*.tsx",
    ],
    rules: { "forgecy/no-hardcoded-text": "error" },
  },
);
