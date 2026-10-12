# Forgecy V11 — client-first creative workspace

Forgecy is a responsive browser-based agency workspace: one client profile at a time, an approved company knowledge base, verified products and services, AI-coordinated campaigns, static Instagram and LinkedIn content, and performance history.

The complete previous repository is preserved under the **old/** folder with its original Git history. The V11 application runs from the new repository root.

## Setup without Docker

1. Install Node.js 22.18 or later and run **npm install**.
2. Create a managed Supabase project (Auth, PostgreSQL, Storage).
3. In the Supabase SQL Editor, apply these migrations **in order**:
   - supabase/migrations/0001_init.sql
   - supabase/migrations/0002_invariants.sql
   - supabase/migrations/0003_knowledge_versions.sql
   - supabase/migrations/0004_content_approval.sql
   - supabase/migrations/0005_editorial_intelligence.sql
4. Copy .env.example to .env.local. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from the Supabase dashboard.
5. Enable email OTP / magic-link sign-in in Supabase Authentication. Allow http://localhost:3000/auth/callback as a redirect URL.
6. Run **npm run dev** and open http://localhost:3000.
7. Add OPENROUTER_API_KEY on the server to enable real AI. Without a key, AI endpoints return configuration errors instead of invented answers.
8. Optionally set OPENAI_API_KEY for images and META_* for Instagram Professional access. Do not add these secrets to any NEXT_PUBLIC_ variable.

To deploy, connect this repository to Vercel (or a compatible Next.js Node host), configure the same environment variables, run the migrations in the production Supabase project and add the production auth redirect URL. Normal development requires no Docker or self-managed database.

## Editorial intelligence from training materials

Library now includes **Voce della community**, where the team can record anonymized questions, objections, reviews and audience feedback. The AI uses observed needs (without treating one comment as a universal trend) to create an inspectable creative brief for static Instagram and LinkedIn content. Per-client brand colors now affect preview and PNG/PDF; a heading font can be documented without automatically installing it. Instagram defaults to 4:5 and LinkedIn documents to 16:9. See [docs/EDITORIAL_INTELLIGENCE.md](docs/EDITORIAL_INTELLIGENCE.md) for source mapping and limitations.

## How work flows

- Switch the active client like an account. All data and chat history are client-scoped.
- Collect reliable website/source notes, private documents and the client's physical products or services.
- Generate a company dossier, inspect sources and hypotheses, and approve the current version.
- Ask the Leader in chat: “A settembre promuovi gli ammorbidenti con post Instagram e riadattamenti LinkedIn”.
- Analyst, Strategist, Copywriter/Art Director and Brand Guard exchange structured outputs, with logged hand-offs.
- Review the proposed campaign. Only explicit approval creates campaign and static content records.
- Modify slides, generate optional images, export PNG/LinkedIn PDF/TXT, and use available real results to inform subsequent strategies.

Supported: **Instagram static posts/carousels** and **LinkedIn text posts/document PDFs**.
Excluded by design: **videos and reels**.

## Validation

The Forgecy V11 GitHub Actions workflow runs dependency installation, strict TypeScript checks, Node tests, PostgreSQL migrations + Row-Level Security smoke tests, and a Next.js production build.

A green CI build confirms these checks; it does not prove the external Meta, OpenRouter or OpenAI services work without real accounts and credentials.

## Security and current limitations

Every client-owned table uses Supabase Auth and Postgres RLS. Client ownership is checked server-side. Storage buckets are private; provider credentials stay on the server. The public website fetcher is disabled by default and requires network egress restrictions before enabling.

This is a functional fullstack foundation **not yet a finished production SaaS**. Automatic PDF/DOCX extraction and OCR, durable asynchronous agent queues, fine-grained team roles, channel publishing, per-account AI spending limits and legacy database migrations remain to be built.

Original source code: [old/](old/). More setup and endpoint details: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

License: AGPL-3.0-only. See LICENSE.
