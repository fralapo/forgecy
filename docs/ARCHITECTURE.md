# Forgecy architecture

Self-hosted TypeScript monolith in a single repository: a Next.js app for the interface and API, a worker for long-running work, PostgreSQL with pgvector, Redis for the queue and file storage on disk or S3-compatible. Everything starts with Docker Compose on the agency's machine; only external AI providers, if enabled, leave the network.

```
browser ──► apps/web (Next.js 16) ──► PostgreSQL (state, jobs, jobs_log)
                │  enqueue                 ▲
                ▼                          │
              Redis (BullMQ) ──► apps/worker ──► packages/ai ──► AI providers (optional)
                                       └──► packages/files ──► ./data/media or S3
```

The web app responds immediately and queues long-running work; the worker runs it and updates the row in `jobs`; the interface reads only that row (via Server-Sent Events on `/api/jobs/:id/events`).

## Package map

| Folder                           | Package           | What it contains                                                                                                                                      | Depends on                              |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `apps/web`                       | `@forgecy/web`    | Next.js App Router: pages, server actions, API routes, sign-in (Better Auth), `proxy.ts`                                                              | all packages                            |
| `apps/worker`                    | `@forgecy/worker` | BullMQ process, health on `:3001`, recovery of stuck jobs                                                                                             | core, db, jobs, ai, files, mail, backup |
| `packages/core`                  | `@forgecy/core`   | Configuration (`loadEnv`), permissions (`can`, `assertCan`), AI policy, content and job states, domain errors                                         | zod                                     |
| `packages/db`                    | `@forgecy/db`     | Drizzle schema (one file per module in `src/schema/`), migrations, `getDb`, `recordAuditEvent`, seed                                                  | core                                    |
| `packages/ai`                    | `@forgecy/ai`     | AI gateway: Anthropic, OpenAI, OpenRouter, DeepSeek, local, OpenAI, Google and OpenRouter image adapters; policy, budget, `jobs_log`, BYOK encryption | core, db                                |
| `packages/jobs`                  | `@forgecy/jobs`   | Job registry (`defineJob`), `enqueueJob`, worker, content locks, SSE events, recovery                                                                 | core, db, bullmq, ioredis               |
| `packages/files`                 | `@forgecy/files`  | Storage drivers (disk, S3), signed URLs, upload checks                                                                                                | core                                    |
| `packages/mail`                  | `@forgecy/mail`   | SMTP (Mailpit in development), magic link email                                                                                                       | core                                    |
| `packages/backup`                | `@forgecy/backup` | Backup archives (database dump, media, manifest), the `system.backup` job and the nightly schedule                                                    | core, db, jobs                          |
| `packages/i18n`                  | `@forgecy/i18n`   | Message files per language (`messages/<locale>/*.json`), English fallback, formatting, translator for the worker and emails                           | core                                    |
| `packages/ui`                    | `@forgecy/ui`     | DTCG tokens → `tokens.css` and Tailwind 4 theme, components, `/design` page                                                                           | react                                   |
| `docs/agents/`                   | —                 | One file per AI agent (role, input, output, constraints)                                                                                              | —                                       |
| `templates/`                     | —                 | Starter templates in the canonical format (HTML, CSS, `template.json`)                                                                                | —                                       |
| `docker/`, `docker-compose*.yml` | —                 | `web`, `worker`, `migrate` images; `dev`, `s3`, `https` profiles                                                                                      | —                                       |
| `scripts/`                       | —                 | `pnpm forgecy` CLI (start, migrate, seed, backup, restore, upgrade, health)                                                                           | —                                       |

Internal packages export their TypeScript sources ("just in time"): no intermediate builds, Next.js compiles them with `transpilePackages`, the worker and migrations run with `tsx`, with no package manager at runtime.

## Conventions

- **Schema and migrations.** Each module has its own file in `packages/db/src/schema/<module>.ts`, exported from `schema/index.ts` with one line. Migrations are generated with `pnpm db:generate` and are not written by hand (except for custom SQL, e.g. extensions). Two threads generating migrations in parallel conflict on `migrations/meta/_journal.json`: whoever comes second merges `main`, deletes their own migration and regenerates it. CI fails if schema and migrations diverge.
- **Enums.** The values live in `packages/core` and the database imports them, so Zod and Postgres do not diverge.
- **Permissions.** Every server action and route calls `requireUser()` (or `withUser` for API routes) and then `assertCan(user.actor, permission, clientId)`. Agents only have `view` and `propose`: approving, publishing and archiving is always done by a person.
- **Activity log.** Every relevant change writes `recordAuditEvent` in the same transaction.
- **Jobs.** Each module defines its jobs with `defineJob` in its own package and adds the handlers in `apps/worker/src/handlers.ts` (one spread line). The payload stays in Postgres; Redis only receives the id. Three attempts (immediately, 5 s, 30 s); `NeedsAttentionError` leads to "needs attention".
- **AI.** Never call an SDK directly: `createAiGateway` applies the client policy and budget and records every attempt in `jobs_log` (only hashes of the data sent, never the text).
- **Files.** Keys are deterministic (`contentKey`), files are served only with short-lived signed URLs (`/api/files/...`), uploads go through `validateUpload`.
- **Interface.** Only `@forgecy/ui` tokens (`bg-app`, `bg-surface`, `text-fg`, `text-fg-muted`, `border-subtle`, `text-heading-*`, `font-display`...). The Tailwind theme has no default palette, lint blocks hand-written colors and the contrast test blocks tokens below WCAG AA. Lucide icons.
- **Text and languages.** No interface text in components: messages in `packages/i18n/messages/<locale>/<namespace>.json`, read with next-intl (`getTranslations`, `useTranslations`). English is the source and fallback; the interface language is a personal preference, separate from the deliverable language. See [I18N.md](I18N.md).
- **Navigation.** Each module adds its entry in `apps/web/components/app-shell.tsx` (one line) and its pages in `apps/web/app/(app)/<section>/`.
- **Tests.** Vitest for packages; integration tests run only with `FORGECY_TEST_DATABASE_URL` and `FORGECY_TEST_REDIS_URL` (CI sets them). Don't run them with a development worker running: they share the `default` queue.
- **Decisions.** Anything that changes the technical specification goes in `docs/adr/`.

## Split of the next modules

Each row is a thread that can start in parallel with the others. Shared files are touched only with the one-line additions listed above (schema index, worker handlers, navigation entry, seed).

| Thread                               | Milestone | Folders it owns                                                                                                                                                                            | Depends on                                        |
| ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Prospect audits                      | M2        | `packages/audit/`, `packages/db/src/schema/audit.ts`, `apps/web/app/(app)/audit/`                                                                                                          | foundations                                       |
| Renderer, templates and export       | M3        | `packages/carousel/` (SlideRenderer, `template.json`, layouts), `templates/`, `apps/web/app/render/`, `apps/web/app/(app)/templates/`, `worker` target of the Dockerfile (Playwright base) | foundations                                       |
| Brand Identity                       | M4        | `packages/brand/`, `packages/db/src/schema/brand.ts`, `apps/web/app/(app)/brand/`                                                                                                          | foundations; uses the Audit findings when present |
| Product catalog                      | M4–M5     | `packages/catalog/`, `packages/db/src/schema/catalog.ts`, `apps/web/app/(app)/products/`                                                                                                   | foundations, files                                |
| Content and carousels                | M5        | `packages/content/`, `packages/db/src/schema/content.ts`, `apps/web/app/(app)/content/`                                                                                                    | Renderer and Brand Identity                       |
| Brand Guard, review and final export | M6        | `packages/brand-guard/`, approvals and export gate                                                                                                                                         | Content                                           |
| Advanced settings                    | M1–M6     | `apps/web/app/(app)/settings/` (budget, BYOK keys, policy, System page, backups from the interface)                                                                                        | foundations                                       |

The first four can start right away; Content and Brand Guard start once the renderer and Brand Identity have their public interfaces.
