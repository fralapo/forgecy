# Forgecy · guide for contributors (people and agents)

Forgecy is an internal agency tool, open source and self-hosted: prospect audits, Brand Identity, content strategy and static carousels. Static only, no video at any stage.

## Commands

- `pnpm install` · `pnpm dev` (web on :3000, worker with health on :3001)
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm format`
- `pnpm db:generate` (after every schema change) · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm tokens` (regenerates `packages/ui/src/generated/tokens.css` from `packages/ui/tokens/forgecy.tokens.json`)
- `pnpm forgecy <start|stop|migrate|seed|backup|restore|upgrade|health>`

## Rules

- TypeScript strict everywhere, ESM, no `any` without a reason.
- Shared Zod schemas and enums live in `packages/core`; database enums import them from there.
- No part calls an AI provider directly: everything goes through `packages/ai` (client policy, budget, `jobs_log`).
- The AI never writes HTML: it picks layouts and fills slots that the renderer inserts as text.
- AI agents propose and do not approve: `can()` in `packages/core` enforces this server-side.
- Every query filters by permissions; no resource can be read just by knowing its id.
- Interface: only `@forgecy/ui` tokens, no hand-written colors or sizes (lint blocks them), Lucide icons, UI text in English.
- Secrets only in `.env`; never in logs, never in the client.
- Every schema change has its generated migration; CI fails if schema and migrations diverge.
- Decisions that change the technical specification go in `docs/adr/`.
- Only free, open-source dependencies; the only allowed costs are the APIs of the AI providers chosen by the agency.

The package map and folder boundaries are in `docs/ARCHITECTURE.md`.
