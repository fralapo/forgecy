# 0001 · Better Auth al posto di Auth.js

- Stato: accettata (M1)
- Data: 2026-10-05

## Contesto

La scheda prevede Auth.js per password locale, magic link e Google OAuth. Da settembre 2025 Auth.js è in manutenzione (solo patch di sicurezza): lo mantiene il team di Better Auth, che consiglia Better Auth per i progetti nuovi.

## Decisione

Usiamo Better Auth (MIT, self-hosted, sessioni nel nostro PostgreSQL) con l'adattatore Drizzle. Copre i tre livelli di accesso della scheda:

- `local` e `intranet`: email e password; la registrazione pubblica è spenta, gli account li crea il primo avvio (`/setup`) o un Admin.
- `team`: in più magic link (token salvato solo come hash, scadenza `FORGECY_MAGIC_LINK_TTL_MINUTES`, default 15) e Google OAuth, solo per i domini in `FORGECY_ALLOWED_EMAIL_DOMAINS`.

Telemetria di Better Auth spenta, limite di frequenza attivo sui login, utenti disattivati bloccati alla creazione della sessione.

## Conseguenze

Le tabelle di identità sono `users`, `sessions`, `accounts`, `verifications` (`packages/db/src/schema/auth.ts`). La password sta in `accounts.password` e non in `users.password_hash` come nella scheda. I permessi restano nel codice (`can()` in `packages/core`), indipendenti dalla libreria di login.
