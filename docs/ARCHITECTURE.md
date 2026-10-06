# Architettura di Forgecy

Monolite TypeScript self-hosted in un solo repository: un'app Next.js per interfaccia e API, un worker per i lavori lunghi, PostgreSQL con pgvector, Redis per la coda e uno storage di file su disco o S3 compatibile. Tutto parte con Docker Compose sulla macchina dell'agenzia; solo i provider AI esterni, se abilitati, escono dalla rete.

```
browser ──► apps/web (Next.js 16) ──► PostgreSQL (stato, job, jobs_log)
                │  enqueue                 ▲
                ▼                          │
              Redis (BullMQ) ──► apps/worker ──► packages/ai ──► provider AI (opzionali)
                                       └──► packages/files ──► ./data/media o S3
```

L'app web risponde subito e mette in coda i lavori lunghi; il worker li esegue e aggiorna la riga in `jobs`; l'interfaccia legge solo quella riga (via Server-Sent Events su `/api/jobs/:id/events`).

## Mappa dei pacchetti

| Cartella                         | Pacchetto         | Cosa contiene                                                                                                                      | Dipende da                      |
| -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `apps/web`                       | `@forgecy/web`    | Next.js App Router: pagine, server action, route API, login (Better Auth), `proxy.ts`                                              | tutti i pacchetti               |
| `apps/worker`                    | `@forgecy/worker` | Processo BullMQ, health su `:3001`, recupero dei job rimasti appesi                                                                | core, db, jobs, ai, files, mail |
| `packages/core`                  | `@forgecy/core`   | Configurazione (`loadEnv`), permessi (`can`, `assertCan`), policy AI, stati di contenuti e job, errori di dominio                  | zod                             |
| `packages/db`                    | `@forgecy/db`     | Schema Drizzle (un file per modulo in `src/schema/`), migrazioni, `getDb`, `recordAuditEvent`, seed                                | core                            |
| `packages/ai`                    | `@forgecy/ai`     | Gateway AI: adattatori Anthropic, OpenAI, OpenRouter, locale, immagini OpenAI e Google; policy, budget, `jobs_log`, cifratura BYOK | core, db                        |
| `packages/jobs`                  | `@forgecy/jobs`   | Registro dei job (`defineJob`), `enqueueJob`, worker, lock sui contenuti, eventi per SSE, recupero                                 | core, db, bullmq, ioredis       |
| `packages/files`                 | `@forgecy/files`  | Driver di storage (disco, S3), URL firmati, controllo degli upload                                                                 | core                            |
| `packages/mail`                  | `@forgecy/mail`   | SMTP (Mailpit in sviluppo), email del magic link                                                                                   | core                            |
| `packages/ui`                    | `@forgecy/ui`     | Token DTCG → `tokens.css` e tema Tailwind 4, componenti, pagina `/design`                                                          | react                           |
| `docs/agents/`                   | —                 | Un file per agente AI (ruolo, input, output, vincoli)                                                                              | —                               |
| `templates/`                     | —                 | Template iniziali nel formato canonico (HTML, CSS, `template.json`)                                                                | —                               |
| `docker/`, `docker-compose*.yml` | —                 | Immagini `web`, `worker`, `migrate`; profili `dev`, `s3`, `https`                                                                  | —                               |
| `scripts/`                       | —                 | CLI `pnpm forgecy` (start, migrate, seed, backup, restore, upgrade, health)                                                        | —                               |

I pacchetti interni esportano i sorgenti TypeScript ("just in time"): niente build intermedie, Next.js li compila con `transpilePackages`, il worker e le migrazioni girano con `tsx`, senza package manager a runtime.

## Convenzioni

- **Schema e migrazioni.** Ogni modulo ha il suo file in `packages/db/src/schema/<modulo>.ts`, esportato da `schema/index.ts` con una riga. Le migrazioni si generano con `pnpm db:generate` e non si scrivono a mano (salvo SQL personalizzato, es. estensioni). Due thread che generano migrazioni in parallelo vanno in conflitto su `migrations/meta/_journal.json`: chi arriva secondo fa merge di `main`, cancella la propria migrazione e la rigenera. La CI fallisce se schema e migrazioni divergono.
- **Enum.** I valori stanno in `packages/core` e il database li importa, così Zod e Postgres non divergono.
- **Permessi.** Ogni server action e route chiama `requireUser()` (o `withUser` per le route API) e poi `assertCan(user.actor, permesso, clientId)`. Gli agenti hanno solo `view` e `propose`: approvare, pubblicare e archiviare è sempre di una persona.
- **Activity log.** Ogni modifica rilevante scrive `recordAuditEvent` nella stessa transazione.
- **Job.** Ogni modulo definisce i suoi job con `defineJob` nel proprio pacchetto e aggiunge gli handler in `apps/worker/src/handlers.ts` (una riga di spread). Il payload resta in Postgres; Redis riceve solo l'id. Tre tentativi (subito, 5 s, 30 s); `NeedsAttentionError` porta a "richiede intervento".
- **AI.** Mai chiamare un SDK direttamente: `createAiGateway` applica policy del cliente, budget e registra ogni tentativo in `jobs_log` (solo hash dei dati inviati, mai il testo).
- **File.** Le chiavi sono deterministiche (`contentKey`), i file si servono solo con URL firmati a scadenza breve (`/api/files/...`), gli upload passano da `validateUpload`.
- **Interfaccia.** Solo token di `@forgecy/ui` (`bg-app`, `bg-surface`, `text-fg`, `text-fg-muted`, `border-subtle`, `text-heading-*`, `font-display`...). Il tema Tailwind non ha la palette predefinita, il lint blocca colori scritti a mano e il test di contrasto blocca token sotto WCAG AA. Testi in italiano, icone Lucide.
- **Navigazione.** Ogni modulo aggiunge la sua voce in `apps/web/components/app-shell.tsx` (una riga) e le sue pagine in `apps/web/app/(app)/<sezione>/`.
- **Test.** Vitest per i pacchetti; i test di integrazione partono solo con `FORGECY_TEST_DATABASE_URL` e `FORGECY_TEST_REDIS_URL` (la CI li imposta). Non lanciarli con un worker di sviluppo acceso: condividono la coda `default`.
- **Decisioni.** Ciò che cambia la scheda tecnica va in `docs/adr/`.

## Suddivisione dei moduli successivi

Ogni riga è un thread che può partire in parallelo agli altri. I file condivisi si toccano solo con le aggiunte di una riga indicate sopra (indice dello schema, handler del worker, voce di navigazione, seed).

| Thread                                  | Milestone | Cartelle di sua proprietà                                                                                                                                                             | Dipende da                                                |
| --------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Audit dei prospect                      | M2        | `packages/audit/`, `packages/db/src/schema/audit.ts`, `apps/web/app/(app)/audit/`                                                                                                     | fondamenta                                                |
| Renderer, template ed export            | M3        | `packages/carousel/` (SlideRenderer, `template.json`, layout), `templates/`, `apps/web/app/render/`, `apps/web/app/(app)/template/`, target `worker` del Dockerfile (base Playwright) | fondamenta                                                |
| Brand Identity                          | M4        | `packages/brand/`, `packages/db/src/schema/brand.ts`, `apps/web/app/(app)/brand/`                                                                                                     | fondamenta; usa le osservazioni dell'Audit quando ci sono |
| Catalogo prodotti                       | M4–M5     | `packages/catalog/`, `packages/db/src/schema/catalog.ts`, `apps/web/app/(app)/products/`                                                                                              | fondamenta, files                                         |
| Contenuti e caroselli                   | M5        | `packages/content/`, `packages/db/src/schema/content.ts`, `apps/web/app/(app)/content/`                                                                                               | Renderer e Brand Identity                                 |
| Brand Guard, revisione ed export finale | M6        | `packages/brand-guard/`, approvazioni e gate di export                                                                                                                                | Contenuti                                                 |
| Impostazioni avanzate                   | M1–M6     | `apps/web/app/(app)/settings/` (budget, chiavi BYOK, policy, pagina Sistema, backup dall'interfaccia)                                                                                 | fondamenta                                                |

I primi quattro possono partire subito; Contenuti e Brand Guard partono quando renderer e Brand Identity hanno le loro interfacce pubbliche.
