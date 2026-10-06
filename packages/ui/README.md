# @forgecy/ui

Token, stili e componenti dell'interfaccia di Forgecy (shadcn/ui personalizzato solo tramite token).

## Dove vivono i token

- **Sorgente unica:** `tokens/forgecy.tokens.json`, formato W3C DTCG 2025.10. Tre livelli: colori di riferimento (`color.*`), token semantici per tema (`semantic.light.*`, `semantic.dark.*`, stessi percorsi), più font, scala tipografica, raggi, spazi, linee, ombre e movimento.
- **Generato:** `src/generated/tokens.css` (versionato). Contiene le variabili `--fc-*` per il tema chiaro (`:root`) e scuro (`[data-theme="dark"]`), le variabili di shadcn/ui (`--background`, `--primary`, `--ring`…) e il blocco `@theme inline` di Tailwind 4.
- Le modifiche ai token passano da pull request approvata dal Product Owner.

## Rigenerare

```sh
pnpm tokens                         # dalla radice, oppure pnpm --filter @forgecy/ui tokens
pnpm --filter @forgecy/ui tokens:check   # fallisce se tokens.css non è aggiornato
pnpm --filter @forgecy/ui test           # Brand Guard: contrasti WCAG 2.2 in chiaro e scuro
```

Lo script si ferma se una coppia di token semantici scende sotto il contrasto minimo (4,5:1 testo, 3:1 controlli e focus).

## Uso nell'app

```css
@import "tailwindcss";
@import "@forgecy/ui/styles.css";
@source "../../../packages/ui/src";
```

Classi principali: `bg-app`, `bg-surface`, `text-fg`, `text-fg-muted`, `text-link`, `border-subtle`, `border-control`, `bg-primary`, `text-primary-foreground`, `text-success|warning|error`, `bg-highlight`, `font-display`, `font-body`, `font-mono`, `text-heading-xl…mono-md`, `rounded-sm…xl`, `shadow-dropdown`, `shadow-modal`. La palette e la scala di testo predefinite di Tailwind sono disattivate.

## Regola

**Nessun colore, font, raggio o misura scritto a mano fuori dai token.** Si usano solo i token semantici (classi sopra o variabili `--fc-*`); mai esadecimali, `bg-white`, `text-[13px]` o simili. Lo stato non si comunica mai solo con il colore: sempre icona Lucide ed etichetta.
