# 0004 · Il worker rende le slide in processo, senza passare dalla route /render

- Stato: accettata (M3)
- Data: 2026-10-06

## Contesto

La scheda descrive l'export così: il worker apre in Chromium la route interna `/render/[versionId]/[slide]` dell'app web con un token di servizio (`FORGECY_RENDER_TOKEN`) e fotografa la pagina. Così il worker dipende dall'app web accesa e raggiungibile, e la route deve accettare un secondo tipo di autenticazione.

## Decisione

`SlideRenderer` (`renderSlideHtml` in `packages/carousel`) è una funzione pura che restituisce un documento HTML autosufficiente: CSS inline, font e immagini come `data:` URL, CSP che vieta ogni richiesta di rete. La usano tutti allo stesso modo:

- il worker la chiama in processo e passa l'HTML a Chromium con `page.setContent`, con la rete bloccata;
- l'app web la serve dalle route `/render/templates/...` (catalogo ed editor dei template) e `/render/slide` (anteprima dell'editor), dietro la sessione dell'utente.

Stessa funzione e stessi byte in ingresso danno la stessa slide in anteprima e in export. `FORGECY_RENDER_TOKEN` non serve più al renderer.

## Conseguenze

L'export funziona anche con l'app web spenta e non apre una porta di servizio. Il worker deve leggere i template dal catalogo nel database (pacchetti ZIP nello storage) e gli asset dallo storage, con il controllo che ogni asset appartenga al cliente dell'export. L'immagine `worker` parte da `mcr.microsoft.com/playwright` con la stessa versione di `playwright-core`; un test lo verifica.
