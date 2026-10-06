<a id="readme-top"></a>

<div align="center">

# Forgecy

**Il motore creativo dell'agenzia: dai brief ai caroselli brandizzati.**

[![Stato: in sviluppo][status-shield]][status-url]
[![Ultimo commit][commit-shield]][commit-url]

</div>

## Cos'è

Forgecy è uno strumento interno per un'agenzia di comunicazione, open source e self-hosted. Analizza prospect e clienti, ne definisce la brand identity e arriva a caroselli social statici pronti da consegnare, con colori, font e tono di voce del brand già applicati.

Gira sulla macchina dell'agenzia con Docker Compose, senza servizi cloud obbligatori. Gli unici costi sono quelli delle API dei provider AI che l'agenzia decide di collegare (Anthropic, OpenAI, OpenRouter, Google); i modelli locali via Ollama o LM Studio sono supportati.

## Come funziona

1. **Prospect e Audit**: analisi di sito, social e competitor, con diagnosi, piano di 30 giorni e report PDF in cui ogni osservazione cita la sua evidenza.
2. **Brand Identity**: strategia, voce, identità visiva con design token, versionata e approvata da una persona dell'agenzia.
3. **Content strategy e brief**: pilastri, rubriche e brief strutturati per canale.
4. **Carosello**: scaletta e slide generate dentro i template dell'agenzia, immagini statiche AI facoltative.
5. **Revisione**: editor slide per slide, brand check e approvazione interna.
6. **Export**: PNG, PDF e ZIP nelle misure esatte dei canali.

Gli agenti AI analizzano e propongono; approva e pubblica sempre una persona. Niente video, in nessuna fase.

## Installazione (Docker)

Serve Docker con Compose.

```bash
cp .env.example .env          # imposta almeno POSTGRES_PASSWORD e BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --build  # postgres, redis, migrate, web, worker
```

Apri `http://localhost:3000`: al primo avvio crei l'account Admin. I dati stanno in `./data` (database, file, backup).

Profili facoltativi: `--profile dev` (Mailpit su `:8025` per le email), `--profile s3` (storage S3 con SeaweedFS), `--profile https` (Caddy per HTTPS in rete interna).

| Comando                                 | Cosa fa                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `pnpm forgecy start` / `stop`           | Avvia o ferma lo stack                                   |
| `pnpm forgecy backup`                   | Archivio `.tar.gz` con database e file in `data/backups` |
| `pnpm forgecy restore <archivio> --yes` | Ripristina database e file                               |
| `pnpm forgecy upgrade`                  | Backup, nuova build, migrazioni, riavvio                 |
| `pnpm forgecy health`                   | Controlla web e worker                                   |

## Sviluppo

Servono Node.js 22 (>= 22.18), pnpm 10 e Docker per i servizi.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres con pgvector, Redis, Mailpit
cp .env.example .env                             # DATABASE_URL=postgres://forgecy:forgecy@localhost:5432/forgecy
pnpm db:migrate && pnpm db:seed
pnpm dev                                         # web su :3000, worker con health su :3001
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` sono gli stessi controlli della CI. Architettura, pacchetti e convenzioni sono in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); le regole per chi sviluppa (anche con Claude Code) in [CLAUDE.md](CLAUDE.md); le decisioni in [docs/adr](docs/adr).

## Stato

- [x] Raccolta dei requisiti
- [x] Scheda tecnica (documento interno)
- [x] Fondamenta (M1): monorepo, database, accesso, gateway AI, coda dei job, storage, design system, Docker, CI
- [ ] Audit dei prospect con report PDF (M2–M3)
- [ ] Brand Identity, content strategy e caroselli (M4–M6)

<p align="right">(<a href="#readme-top">torna su</a>)</p>

[status-shield]: https://img.shields.io/badge/stato-in%20sviluppo-blue?style=flat-square
[status-url]: https://github.com/fralapo/forgecy
[commit-shield]: https://img.shields.io/github/last-commit/fralapo/forgecy?style=flat-square
[commit-url]: https://github.com/fralapo/forgecy/commits/main
