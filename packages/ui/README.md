# @forgecy/ui

Tokens, styles and components of the Forgecy interface (shadcn/ui customized only through tokens).

## Where the tokens live

- **Single source:** `tokens/forgecy.tokens.json`, W3C DTCG 2025.10 format. Three levels: reference colors (`color.*`), semantic tokens per theme (`semantic.light.*`, `semantic.dark.*`, same paths), plus fonts, type scale, radii, spacing, lines, shadows and motion.
- **Generated:** `src/generated/tokens.css` (versioned). It contains the `--fc-*` variables for the light theme (`:root`) and dark theme (`[data-theme="dark"]`), the shadcn/ui variables (`--background`, `--primary`, `--ring`…) and the Tailwind 4 `@theme inline` block.
- Token changes go through a pull request approved by the Product Owner.

## Regenerating

```sh
pnpm tokens                         # from the root, or pnpm --filter @forgecy/ui tokens
pnpm --filter @forgecy/ui tokens:check   # fails if tokens.css is not up to date
pnpm --filter @forgecy/ui test           # Brand Guard: WCAG 2.2 contrast in light and dark
```

The script stops if a pair of semantic tokens falls below the minimum contrast (4.5:1 text, 3:1 controls and focus).

## Use in the app

```css
@import "tailwindcss";
@import "@forgecy/ui/styles.css";
@source "../../../packages/ui/src";
```

Main classes: `bg-app`, `bg-surface`, `text-fg`, `text-fg-muted`, `text-link`, `border-subtle`, `border-control`, `bg-primary`, `text-primary-foreground`, `text-success|warning|error`, `bg-highlight`, `font-display`, `font-body`, `font-mono`, `text-heading-xl…mono-md`, `rounded-sm…xl`, `shadow-dropdown`, `shadow-modal`. Tailwind's default palette and text scale are disabled.

## Rule

**No color, font, radius or size written by hand outside the tokens.** Use only the semantic tokens (classes above or `--fc-*` variables); never hex values, `bg-white`, `text-[13px]` or the like. State is never conveyed by color alone: always a Lucide icon and a label.
