# Forgecy · istruzioni per chi sviluppa (persone e agenti)

Forgecy è uno strumento interno di agenzia, open source e self-hosted: audit dei prospect, Brand Identity, content strategy e caroselli statici. Solo statico, niente video in nessuna fase.

## Comandi

- `pnpm install` · `pnpm dev` (web su :3000, worker con health su :3001)
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format`
- `pnpm db:generate` (dopo ogni modifica allo schema) · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm tokens` (rigenera `packages/ui/src/generated/tokens.css` da `packages/ui/tokens/forgecy.tokens.json`)
- `pnpm forgecy <start|stop|migrate|seed|backup|restore|upgrade|health>`

## Regole

- TypeScript strict ovunque, ESM, nessun `any` senza motivo.
- Schemi Zod ed enum condivisi in `packages/core`; gli enum del database li importano da lì.
- Nessuna parte chiama un provider AI direttamente: tutto passa da `packages/ai` (policy del cliente, budget, `jobs_log`).
- L'AI non scrive mai HTML: sceglie layout e riempie slot che il renderer inserisce come testo.
- Gli agenti AI propongono e non approvano: `can()` in `packages/core` lo impone lato server.
- Ogni query filtra per permessi; nessuna risorsa si legge solo conoscendo l'id.
- Interfaccia: solo token di `@forgecy/ui`, niente colori o misure scritti a mano (il lint lo blocca), icone Lucide, testi in italiano.
- Segreti solo in `.env`; mai nei log, mai nel client.
- Ogni modifica allo schema ha la sua migrazione generata; la CI fallisce se schema e migrazioni divergono.
- Le decisioni che cambiano la scheda tecnica vanno in `docs/adr/`.
- Dipendenze solo open source e gratuite; gli unici costi ammessi sono le API dei provider AI scelti dall'agenzia.

La mappa dei pacchetti e i confini di cartella sono in `docs/ARCHITECTURE.md`.
