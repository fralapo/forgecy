# Agency templates

Starter templates in Forgecy's canonical format: grouped by kind (`carousels/`, `reports/`), one folder per template with `template.json` (slots, text limits, color and font roles, safe zone, rules), `layouts/*.html`, `styles.css`, `locales/` (printed labels per language), `fonts/` and `assets/`. Figma, Canva, PDF and PNG are only references: every template is rebuilt here in HTML and CSS.

| Folder                         | Format                    | Layouts |
| ------------------------------ | ------------------------- | ------- |
| `carousels/editorial-ig-4x5`   | Instagram 4:5 · 1080×1350 | 8       |
| `carousels/editorial-linkedin` | LinkedIn document · PDF   | 8       |
| `reports/report-audit-a4`      | A4 report · PDF 150 dpi   | 6       |

`report-audit-a4` is the audit report (`kind: "report"`, no `channel`): cover, section, finding with evidence and recommendation, problem, next steps, method. The PDF comes out in true A4 format; there is also the `report_16x9` format (1920×1080) for reports to be projected.

Rules for writing a template:

- Every slot is an element with `data-slot="name"` declared in `template.json`: text in any element, lists in `<ul>`/`<ol>` with one sample `<li>`, images in `<img>`. The renderer inserts the values as text; an empty slot gets `data-empty` and is hidden.
- Automatic elements: `data-fc="page"`, `"total"`, `"logo"`, `"brand-name"`, `"handle"`.
- Printed labels (“Swipe”, “Prepared by”...) are marked `data-fc-text="key"` and translated in `locales/<language>.json`, one file per language (`{ "swipe": "Scorri" }`). They follow the deliverable's language (chosen per content or audit), not the interface language; `locales/en.json` is required and is the fallback for missing keys. The text written in the layout is only the last fallback.
- Colors and fonts only from `--fc-*` variables bound to a role in `colorRoles` and `fontRoles`; no hand-written colors, `font-size` only from the `typeScale`. Renderer variables: `--fc-width`, `--fc-height`, `--fc-safe-top|right|bottom|left`.
- Variants with `[data-tone="inverse"]`, `[data-first]`, `[data-last]` on the `.fc-slide` root.
- No scripts, external links, `@import` or `@font-face`: fonts and images live in the package.

To use them, import them from the Templates page (section “To import from the agency’s folder”) or as a ZIP: they become drafts in the catalog and must be published. A change to an already published template requires bumping `version` in `template.json`.

Check: `pnpm --filter @forgecy/carousel preview ../../templates/<kind>/<folder> /tmp/out`. The fonts are Space Grotesk and Inter (SIL Open Font License 1.1, licenses in `fonts/`).
