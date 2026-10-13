# Forgecy — client-first AI agency workspace (V18 development branch)

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
   - supabase/migrations/0006_quality_gates.sql
   - supabase/migrations/0007_source_intelligence.sql
   - supabase/migrations/0008_ai_jobs.sql
   - supabase/migrations/0009_strategic_blueprints.sql
   - supabase/migrations/0010_editorial_calendar.sql
   - supabase/migrations/0011_client_evidence_search.sql
   - supabase/migrations/0012_website_crawl_budgets.sql
   - supabase/migrations/0013_source_chunks.sql
   - supabase/migrations/0014_source_chunks_backfill.sql
   - supabase/migrations/0015_ai_worker_fencing.sql
   - supabase/migrations/0016_ai_request_budgets.sql
4. Copy .env.example to .env.local. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from the Supabase dashboard.
5. Enable email OTP / magic-link sign-in in Supabase Authentication. Allow http://localhost:3000/auth/callback as a redirect URL.
6. Run **npm run dev** and open http://localhost:3000.
7. Add OPENROUTER_API_KEY on the server to enable real AI. Without a key, AI endpoints return configuration errors instead of invented answers.
8. To run queued AI work, configure `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` on the backend and schedule the protected `/api/jobs/dispatch` endpoint. See [AI_JOB_RUNNER.md](docs/AI_JOB_RUNNER.md).
9. Optionally set `OPENAI_API_KEY` for generated images and `META_*` for Instagram Professional access. Do not add secrets to a `NEXT_PUBLIC_` variable.
10. Do not enable `ENABLE_WEBSITE_INGEST=true` until outbound network restrictions are in place. Apply migration 0012 before deploying the shared crawl budgets; see [CRAWL_BUDGETS.md](docs/CRAWL_BUDGETS.md).

To deploy, connect this repository to Vercel (or a compatible Next.js Node host), configure the same environment variables, run the migrations in the production Supabase project and add the production auth redirect URL. Normal development requires no Docker or self-managed database.

## V21 integration: protected AI workers

All client evidence and V20 search changes are retained, while the worker gains per-attempt fencing tokens, heartbeat renewal and rejection of stale worker writes. Apply migration 0015 after the website quota and indexed excerpt migrations (0012–0014). Do not use the service-role key in the browser. See [docs/INTEGRATION_V21.md](docs/INTEGRATION_V21.md) and [docs/AI_JOB_RUNNER.md](docs/AI_JOB_RUNNER.md).

## Client Knowledge Search (indexed excerpts)

The Library can now search bounded, source-attributed passages from websites and private text documents, rather than relying only on whole-source matches. The Leader and company dossier use these retrieved excerpts, with strict client isolation and evidence validation. This is keyword retrieval, **not semantic embeddings or fact-checking**. Requires migrations 0013 and 0014. Details: [docs/CLIENT_KNOWLEDGE_SEARCH.md](docs/CLIENT_KNOWLEDGE_SEARCH.md).

## Editorial intelligence from training materials

Library now includes **Voce della community**, where the team can record anonymized questions, objections, reviews and audience feedback. The AI uses observed needs (without treating one comment as a universal trend) to create an inspectable creative brief for static Instagram and LinkedIn content. Per-client brand colors now affect preview and PNG/PDF; a heading font can be documented without automatically installing it. Instagram defaults to 4:5 and LinkedIn documents to 16:9. See [docs/EDITORIAL_INTELLIGENCE.md](docs/EDITORIAL_INTELLIGENCE.md) for source mapping and limitations.

## Skill-guided quality and document intelligence

Forgecy selectively adapts stage-specific playbooks from the [MIT-licensed awesome-agent-skills repository](https://github.com/fralapo/awesome-agent-skills). The Analyst, Strategist, Creative and Brand Guard use different instructions and document concrete quality findings before approval. Text PDFs and DOCX can be extracted into client-scoped evidence (scanned files still require OCR). See [docs/SKILLS_INTEGRATION.md](docs/SKILLS_INTEGRATION.md) for the complete 13-skill inventory and limitations.

## How work flows

- Switch the active client like an account. All data and chat history are client-scoped.
- Collect reliable website/source notes, private documents and the client's physical products or services.
- Generate a source-attributed company dossier, inspect sources and hypotheses, and approve the current version.
- Create and approve a separately versioned corporate strategic blueprint with positioning, audience, KPIs and 30/60/90-day roadmap.
- Search uploaded documents and crawled pages using client-scoped PostgreSQL full-text search.
- Ask the Leader in chat: “A settembre promuovi gli ammorbidenti con post Instagram e riadattamenti LinkedIn”. The AI work is queued with a status view.
- Analyst, Strategist, Copywriter/Art Director and Brand Guard exchange structured outputs, with logged hand-offs.
- Review the proposed campaign. Only explicit approval creates campaign and static content records.
- Modify carousel slide layouts, undo/redo, generate optional images, export PNG/LinkedIn PDF/TXT, and track the client editorial calendar.
- Export current-state dossier and company strategy as Markdown; export measured Instagram post data as safe CSV.
- Use authorized Instagram follower/post observations and optional per-post insights to inform future approved strategy changes.

Supported: **Instagram static posts/carousels** and **LinkedIn text posts/document PDFs**.
Excluded by design: **videos and reels**.

## Validation

The Forgecy V11 GitHub Actions workflow runs dependency installation, strict TypeScript checks, Node tests, PostgreSQL migrations + Row-Level Security smoke tests, and a Next.js production build.

A green CI build confirms these checks; it does not prove the external Meta, OpenRouter or OpenAI services work without real accounts and credentials.

## Security and current limitations

Every client-owned table uses Supabase Auth and Postgres RLS. Client ownership is checked server-side. Storage buckets are private; provider credentials stay on the server. The bounded, robots-aware multi-page website crawler is disabled by default and **must not** be enabled without network-level outbound restrictions. Source content hashes and exact-quote evidence reports are stored in private client-scoped tables; they do not replace independent fact checking. See [docs/SOURCE_INTELLIGENCE_BACKEND.md](docs/SOURCE_INTELLIGENCE_BACKEND.md).

This is a functional fullstack foundation **not yet a finished production SaaS**. A basic PostgreSQL-backed AI job queue exists but requires a configured scheduler and an external smoke test. OCR for scans and images, durable multi-stage agent checkpoints, organization/team permissions, channel publishing, reliable Meta token refresh, provider-level token/currency caps, full visual render parity, production observability, and migrations of legacy data remain to be built. See [CURRENT_ROADMAP.md](docs/CURRENT_ROADMAP.md).

Original source code: [old/](old/). More setup and endpoint details: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

License: AGPL-3.0-only. See LICENSE.

## V24 AI request safeguards

The hosted API reserves PostgreSQL-backed per-client and per-owner request quota before synchronous AI calls, while the existing queue RPC reserves capacity for asynchronous work. A 429 response means a rolling quota was reached; failed reservations block external AI calls. These counters are not a monetary spending cap. Deploy migration `0016_ai_request_budgets.sql` before the V24 API code. See [docs/AI_REQUEST_BUDGETS.md](docs/AI_REQUEST_BUDGETS.md).
