# Template dell'agenzia

Template iniziali nel formato canonico di Forgecy: una cartella per template con `template.json` (slot, limiti di testo, ruoli colore e font, safe zone, regole), `layouts/*.html`, `styles.css`, `fonts/` e `assets/`. Figma, Canva, PDF e PNG sono solo riferimenti: ogni template si ricostruisce qui in HTML e CSS.

| Cartella             | Formato                   | Layout |
| -------------------- | ------------------------- | ------ |
| `editorial-ig-4x5`   | Instagram 4:5 · 1080×1350 | 8      |
| `editorial-linkedin` | Documento LinkedIn · PDF  | 8      |
| `report-audit-a4`    | Report A4 · PDF 150 dpi   | 6      |

`report-audit-a4` è il report d'audit (`kind: "report"`, senza `channel`): copertina, sezione, evidenza con prova e raccomandazione, problema, prossimi passi, metodo. Il PDF esce in formato A4 reale; esiste anche il formato `report_16x9` (1920×1080) per report da proiettare.

Regole per scrivere un template:

- Ogni slot è un elemento con `data-slot="nome"` dichiarato in `template.json`: i testi in qualsiasi elemento, gli elenchi in `<ul>`/`<ol>` con un `<li>` di esempio, le immagini in `<img>`. Il renderer inserisce i valori come testo; uno slot vuoto riceve `data-empty` e viene nascosto.
- Elementi automatici: `data-fc="page"`, `"total"`, `"logo"`, `"brand-name"`, `"handle"`.
- Colori e font solo da variabili `--fc-*` legate a un ruolo in `colorRoles` e `fontRoles`; nessun colore scritto a mano, `font-size` solo dalla `typeScale`. Variabili del renderer: `--fc-width`, `--fc-height`, `--fc-safe-top|right|bottom|left`.
- Varianti con `[data-tone="inverse"]`, `[data-first]`, `[data-last]` sulla radice `.fc-slide`.
- Niente script, link esterni, `@import` o `@font-face`: font e immagini stanno nel pacchetto.

Per usarli si importano dalla pagina Template (sezione «Da importare») o come ZIP: diventano bozze nel catalogo e vanno pubblicati. Una modifica a un template già pubblicato richiede di aumentare `version` in `template.json`.

Verifica: `pnpm --filter @forgecy/carousel preview ../../templates/<cartella> /tmp/out`. I font sono Space Grotesk e Inter (SIL Open Font License 1.1, licenze in `fonts/`).
