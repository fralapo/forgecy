<a id="readme-top"></a>

<div align="center">

# Forgecy

**The agency's creative engine: from briefs to branded carousels.**

[![Status: in development][status-shield]][status-url]
[![Last commit][commit-shield]][commit-url]
[![License: AGPL-3.0][license-shield]][license-url]

</div>

## What it is

Forgecy is an internal tool for a communications agency, open source and self-hosted. It analyzes prospects and clients, defines their brand identity and gets to static social carousels ready to deliver, with the brand's colors, fonts and tone of voice already applied.

It runs on the agency's machine with Docker Compose, with no mandatory cloud services. The only costs are the APIs of the AI providers the agency chooses to connect (Anthropic, OpenAI, OpenRouter, DeepSeek, Google), or an image subscription the agency already has (Higgsfield) connected over MCP; local models via Ollama or LM Studio are supported.

## How it works

1. **Prospects and Audit**: analysis of website, social channels and competitors, with a diagnosis, a 30-day plan and a PDF report where every observation cites its finding.
2. **Brand Identity**: strategy, voice, visual identity with design tokens, versioned and approved by a person at the agency.
3. **Content strategy and briefs**: pillars, rubrics and structured briefs per channel, drawing on the client's product catalog.
4. **Carousel**: outline and slides generated inside the agency's templates, optional static AI images.
5. **Review**: slide-by-slide editor, brand check and internal approval.
6. **Export**: PNG, PDF and ZIP in the exact sizes of each channel (Instagram 4:5 and 1:1, Stories 9:16, Facebook 4:5, TikTok photo and LinkedIn document).

AI agents analyze and propose; a person always approves and publishes. No video, at any stage.

## Installation (Docker)

You need Docker with Compose, plus Node.js 22 (>= 22.18) and pnpm 10 for the `pnpm` commands below (without them, copy `.env.example` to `.env`, fill the secrets by hand and use `docker compose` only).

```bash
pnpm install && pnpm forgecy init   # writes .env with generated secrets (or: cp .env.example .env and fill POSTGRES_PASSWORD and BETTER_AUTH_SECRET)
docker compose up -d --build           # postgres, redis, migrate, web, worker
```

Open `http://localhost:3000`: on first start you create the Admin account. Data lives in `./data` (database, files, backups).

Optional profiles: `--profile dev` (Mailpit on `:8025` for emails), `--profile s3` (S3 storage with SeaweedFS), `--profile https` (Caddy for HTTPS on the internal network).

| Command                                | What it does                                                |
| -------------------------------------- | ----------------------------------------------------------- |
| `pnpm forgecy init`                    | Creates `.env` with generated secrets; never overwrites     |
| `pnpm forgecy start` / `stop`          | Starts or stops the stack                                   |
| `pnpm forgecy backup`                  | `.tar.gz` archive with database and files in `data/backups` |
| `pnpm forgecy restore <archive> --yes` | Restores database and files                                 |
| `pnpm forgecy upgrade`                 | Backup, new build, migrations, restart                      |
| `pnpm forgecy health`                  | Checks web and worker                                       |

`start`, `migrate` and `upgrade` stop with a clear message if `POSTGRES_PASSWORD` or `BETTER_AUTH_SECRET` is empty or guessable. `pnpm forgecy init --fill` fills only the secrets that are empty in an existing `.env`, never changes a value that is set, and never generates a database password when `data/db` or `data/dev-db` already exists (that password lives inside the database). A guessable value such as `change-me` is not "empty": on a fresh install it stops `start`, so replace it by hand (for example with `openssl rand -hex 24`) and use the same value in `DATABASE_URL`; on an existing database it only warns, because that value is the password the database was created with (see Upgrading).

### Upgrading

`pnpm forgecy upgrade` takes a backup first. Compose no longer falls back to the password `forgecy`, so the stack will not start until `POSTGRES_PASSWORD` is set in `.env`. The password inside an existing database (`data/db`) does not change when you edit `.env`, so do this before anything else (every `docker compose` command, `exec` included, stops while the variable is missing):

1. Keep the password the database was created with.
   - `.env` has `POSTGRES_PASSWORD=change-me` (the old `.env.example` value) or another value: leave it as it is. `pnpm forgecy start` and `upgrade` work, with a warning.
   - The line is absent or empty: the database used the old default, so add `POSTGRES_PASSWORD=forgecy`.
2. Then rotate it (recommended). With the stack running, run `docker compose exec postgres psql -U forgecy`, type `\password forgecy` and enter the new password at the prompt, then `\q`. Typing it at the prompt keeps it out of the shell history. Use a long random one such as the output of `openssl rand -hex 24` (no spaces and none of `/ @ : % ? # [ ] $ ' " \`). Put the same value in `POSTGRES_PASSWORD` in `.env` (and in `DATABASE_URL` if you run `pnpm dev` against it) and run `docker compose up -d` so web and worker restart with it.

The web port now listens on 127.0.0.1 only (`FORGECY_BIND_ADDRESS`, default `127.0.0.1`). To reach it from other machines, either use `--profile https` (Caddy) or set `FORGECY_BIND_ADDRESS=0.0.0.0` in `.env` and run `docker compose up -d`.

The other changes to check before upgrading are in [section 7 of the security checklist](docs/SECURITY_CHECKLIST.md#7-upgrading-and-follow-ups-left-open-by-the-hardening-work): the strict `FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS`, backups without a checksum, the new backup format, sign-in by username, the optional setup token, unlocking a locked account, a short window during the migration and the dev database password.

### Backups

A backup holds a `pg_dump --format=custom` archive (`db.dump`), restored with `pg_restore` in one transaction ([ADR 0019](docs/adr/0019-custom-format-backups.md)). Before anything connects, its SQL is rendered and checked by the same dump scanner as before. Backups made before that change (plain `db.sql`) still restore with `psql`. A Forgecy older than ADR 0019 refuses the new backups as an unknown format, so restore the pre-upgrade backup before downgrading. A restore runs the backup's SQL as the `DATABASE_URL` role, a superuser in the postgres image. Optionally, restore as a role without superuser rights instead ([ADR 0018](docs/adr/0018-restore-role.md)): create it once, with the stack running:

```bash
docker compose exec postgres psql -U forgecy -d forgecy -c "CREATE ROLE forgecy_restore LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker compose exec postgres psql -U forgecy -d forgecy -c "\password forgecy_restore"
```

Then set `FORGECY_RESTORE_DATABASE_URL=postgres://forgecy_restore:<password>@postgres:5432/forgecy` in `.env` (host `postgres` for Docker; `localhost` for `pnpm dev`) and run `docker compose up -d`. Before each restore Forgecy gives that role ownership of the app's tables and leaves the pgvector entries out of the restore (only a superuser may drop or create that extension). The role cannot run `COPY ... PROGRAM`, read or write server files, `ALTER SYSTEM` or create roles, so a hostile backup cannot do those while it loads. It can still replace all of the app's data, which is what a restore does, and it can leave triggers or functions that later run with the superuser's rights when the app writes, so restore only backups you trust.

## Development

You need Node.js 22 (>= 22.18), pnpm 10 and Docker for the services.

```bash
pnpm install
pnpm forgecy init                                 # .env with generated secrets; the dev database reads POSTGRES_PASSWORD from it
docker compose -f docker-compose.dev.yml up -d   # Postgres with pgvector, Redis, Mailpit (on 127.0.0.1 only)
pnpm db:migrate && pnpm db:seed
pnpm dev                                         # web on :3000, worker with health on :3001
```

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` are the same checks CI runs. Architecture, packages and conventions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the rules for contributors (including with Claude Code) in [CLAUDE.md](CLAUDE.md); decisions in [docs/adr](docs/adr); the AI agents' roles in [docs/agents](docs/agents); translations in [docs/I18N.md](docs/I18N.md).

## Status

The MVP milestones are all on `main`. The repository, code, docs and agent prompts are in English.

- [x] Requirements gathering and technical specification (internal documents)
- [x] **M1 Foundations**: monorepo, database, sign-in, AI gateway, job queue, storage, design system, Docker, CI
- [x] **M2 Prospect audits**: website, social and competitor analysis, cross-source comparison, diagnosis, PDF report, conversion to client
- [x] **M3 Renderer and templates**: agency template catalog (HTML, CSS and `template.json`), slide renderer, PNG/PDF/ZIP export
- [x] **M4 Brand Identity**: versioned identity, brand book import, AI proposals reviewed by a person, approval and publishing
- [x] **Product catalog**: mixed import (CSV, PDF, images), AI extraction with human review, product sheets
- [x] **M5 Content and carousels**: strategy and plan, structured briefs, outline, slide editor, static AI images
- [x] **M6 Brand Guard**: brand consistency checks, internal review and the export gate
- [ ] **M7 (v1)**: client-facing Brand Book, more formats (Instagram 1:1, Stories 9:16, Facebook 4:5, TikTok photo), agent settings, batch automations, full client import/export, dark theme

### Languages

- **Interface**: English (source and fallback) and Italian, chosen per person in Settings; new users get their browser language. Every string lives in `packages/i18n/messages/<locale>/`; [docs/I18N.md](docs/I18N.md) explains how to add a language.
- **Deliverables**: reports and carousels are written in English by default; each audit or content piece can be set to another language, independently of the interface language.

## License

Forgecy is released under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You can use, modify and install it for your agency; if you offer a modified version to others over a network, you must also make its source code available to those users.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[status-shield]: https://img.shields.io/badge/status-in%20development-blue?style=flat-square
[status-url]: https://github.com/fralapo/forgecy
[commit-shield]: https://img.shields.io/github/last-commit/fralapo/forgecy?style=flat-square
[commit-url]: https://github.com/fralapo/forgecy/commits/main
[license-shield]: https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square
[license-url]: LICENSE
