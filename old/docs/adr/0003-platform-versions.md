# 0003 · Platform versions in M1

- Status: accepted (M1)
- Date: 2026-10-05

## Decision

- **TypeScript 6.0.x**, not 7: the native version (7.0) is not yet supported by typescript-eslint and other tools that use the compiler API.
- **Node.js 22 LTS** (>= 22.18), **pnpm 10**, **Turborepo 2**, "just in time" internal packages (they export their TypeScript sources).
- **Next.js 16** with App Router and `proxy.ts`, **React 19**, **Tailwind CSS 4** with generated DTCG tokens.
- **PostgreSQL 17 with pgvector** (image `pgvector/pgvector:pg17`) instead of 16: same compatibility, longer support.
- **Redis 8** for BullMQ (AGPL license among those available).
- **Self-hosted fonts** with the Fontsource packages (OFL license), so the build downloads nothing from Google Fonts.
- **Zod 4** for shared schemas, **Drizzle ORM 0.45** with versioned migrations, **Vitest 4**.

## Consequences

The move to TypeScript 7 happens once typescript-eslint supports it, with a dedicated ADR.
