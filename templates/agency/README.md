# Template dell'agenzia

Template iniziali nel formato canonico di Forgecy: una cartella per template con `template.json` (slot, limiti di testo, ruoli colore e font, safe zone, regole), `layouts/*.html`, `styles.css`, `fonts/` e `assets/`. Figma, Canva, PDF e PNG sono solo riferimenti: ogni template si ricostruisce qui in HTML e CSS.

| Cartella              | Formato                   | Layout |
| --------------------- | ------------------------- | ------ |
| `editoriale-ig-4x5`   | Instagram 4:5 · 1080×1350 | 8      |
| `editoriale-linkedin` | Documento LinkedIn · PDF  | 8      |

Regole per scrivere un template:

- Ogni slot è un elemento con `data-slot="nome"` dichiarato in `template.json`: i testi in qualsiasi elemento, gli elenchi in `<ul>`/`<ol>` con un `<li>` di esempio, le immagini in `<img>`. Il renderer inserisce i valori come testo; uno slot vuoto riceve `data-empty` e viene nascosto.
- Elementi automatici: `data-fc="page"`, `"total"`, `"logo"`, `"brand-name"`, `"handle"`.
- Colori e font solo da variabili `--fc-*` legate a un ruolo in `colorRoles` e `fontRoles`; nessun colore scritto a mano, `font-size` solo dalla `typeScale`. Variabili del renderer: `--fc-width`, `--fc-height`, `--fc-safe-top|right|bottom|left`.
- Varianti con `[data-tone="inverse"]`, `[data-first]`, `[data-last]` sulla radice `.fc-slide`.
- Niente script, link esterni, `@import` o `@font-face`: font e immagini stanno nel pacchetto.

Verifica: `pnpm --filter @forgecy/carousel preview ../../templates/agency/<cartella> /tmp/out`. I font sono Space Grotesk e Inter (SIL Open Font License 1.1, licenze in `fonts/`).
