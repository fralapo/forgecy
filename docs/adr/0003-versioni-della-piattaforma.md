# 0003 · Versioni della piattaforma in M1

- Stato: accettata (M1)
- Data: 2026-10-05

## Decisione

- **TypeScript 6.0.x**, non 7: la versione nativa (7.0) non è ancora supportata da typescript-eslint e da altri strumenti che usano l'API del compilatore.
- **Node.js 22 LTS** (>= 22.18), **pnpm 10**, **Turborepo 2**, pacchetti interni "just in time" (esportano i sorgenti TypeScript).
- **Next.js 16** con App Router e `proxy.ts`, **React 19**, **Tailwind CSS 4** con token DTCG generati.
- **PostgreSQL 17 con pgvector** (immagine `pgvector/pgvector:pg17`) invece di 16: stessa compatibilità, supporto più lungo.
- **Redis 8** per BullMQ (licenza AGPL tra quelle disponibili).
- **Font self-hosted** con i pacchetti Fontsource (licenza OFL), così il build non scarica nulla da Google Fonts.
- **Zod 4** per gli schemi condivisi, **Drizzle ORM 0.45** con migrazioni versionate, **Vitest 4**.

## Conseguenze

Il passaggio a TypeScript 7 si fa quando typescript-eslint lo supporta, con un ADR dedicato.
