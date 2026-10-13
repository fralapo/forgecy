# Forgecy — personal, locally run AI workspace

Forgecy is an open-source project for personal use. Run the application on your own computer, connect your own Supabase project and bring your own AI API keys. It helps you manage client or brand profiles, approved knowledge, products/services, strategies, static Instagram and LinkedIn content, and performance history.

There is no Forgecy-operated hosted service, subscription or shared customer backend. Each installation uses the operator's accounts and credentials; Supabase and enabled AI/social providers remain external services with their own terms and costs. Running the app locally does not make its database or AI processing offline. A separate staging environment is optional, not required for a personal installation.

The complete previous repository is preserved under the **old/** folder with its original Git history. The current Next.js/Supabase application runs from the repository root. Features preserved in `old/` are not automatically part of the current application.

## Run locally without Docker

Follow the step-by-step [local setup guide](docs/LOCAL_SETUP.md), including the local AI dispatcher and troubleshooting. The short version:

1. Install Node.js 22.18 or later, clone this repository, enter its directory and run **npm install**.
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
   - supabase/migrations/0017_ai_provider_usage.sql
4. Copy `.env.example` to `.env.local`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from your Supabase dashboard. Despite the variable names, `sb_publishable_…` is accepted; the private `sb_secret_…` key belongs only in `SUPABASE_SERVICE_ROLE_KEY`. Keep `.env.local` private and untracked.
5. Enable email OTP / magic-link sign-in in Supabase Authentication. Allow http://localhost:3000/auth/callback as a redirect URL.
6. Run **npm run dev -- --hostname 127.0.0.1** and open http://localhost:3000.
7. Add OPENROUTER_API_KEY on the server to enable real AI. Without a key, AI endpoints return configuration errors instead of invented answers.
8. To run queued AI work, configure `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` in `.env.local` and run the local dispatcher described in the setup guide while the app is running. See [AI_JOB_RUNNER.md](docs/AI_JOB_RUNNER.md).
9. Optionally set `OPENAI_API_KEY` for generated images and `META_*` for Instagram Professional access. Do not add secrets to a `NEXT_PUBLIC_` variable.
10. Do not enable `ENABLE_WEBSITE_INGEST=true` until outbound network restrictions are in place. Apply migration 0012 before deploying the shared crawl budgets; see [CRAWL_BUDGETS.md](docs/CRAWL_BUDGETS.md).

A cloud deployment is optional. For a local optimized build, use `npm run build` and `npm run start -- --hostname 127.0.0.1`; `APP_ORIGIN=http://localhost:3000` is required in that mode. If you choose a public host, configure its exact HTTPS origin, auth callback, private environment variables and worker scheduler separately. Normal personal use requires no Docker, public web host or second Supabase project.

## V21 integration: protected AI workers

All client evidence and V20 search changes are retained, while the worker gains per-attempt fencing tokens, heartbeat renewal and rejection of stale worker writes. Apply migration 0015 after the website quota and indexed excerpt migrations (0012–0014). Do not use the service-role key in the browser. See [docs/INTEGRATION_V21.md](docs/INTEGRATION_V21.md) and [docs/AI_JOB_RUNNER.md](docs/AI_JOB_RUNNER.md).

## Client Knowledge Search (indexed excerpts)

The Library can now search bounded, source-attributed passages from websites and private text documents, rather than relying only on whole-source matches. The Leader and company dossier use these retrieved excerpts, with strict client isolation and evidence validation. This is keyword retrieval, **not semantic embeddings or fact-checking**. Requires migrations 0013 and 0014. Details: [docs/CLIENT_KNOWLEDGE_SEARCH.md](docs/CLIENT_KNOWLEDGE_SEARCH.md).

## Editorial intelligence from training materials

Library now includes **Voce della community**, where you can record anonymized questions, objections, reviews and audience feedback. The AI uses observed needs (without treating one comment as a universal trend) to create an inspectable creative brief for static Instagram and LinkedIn content. Per-client brand colors now affect preview and PNG/PDF; a heading font can be documented without automatically installing it. Instagram defaults to 4:5 and LinkedIn documents to 16:9. See [docs/EDITORIAL_INTELLIGENCE.md](docs/EDITORIAL_INTELLIGENCE.md) for source mapping and limitations.

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

The GitHub Actions quality workflow runs dependency installation, strict TypeScript checks, Node tests, PostgreSQL migrations + Row-Level Security smoke tests, and a Next.js production build.

A green CI build confirms these checks; it does not prove the external Meta, OpenRouter or OpenAI services work without real accounts and credentials.

## Security and current limitations

Every client-owned table uses Supabase Auth and Postgres RLS. Client ownership is checked server-side. Storage buckets are private; provider credentials stay on the server. The bounded, robots-aware multi-page website crawler is disabled by default and **must not** be enabled without network-level outbound restrictions. Source content hashes and exact-quote evidence reports are stored in private client-scoped tables; they do not replace independent fact checking. See [docs/SOURCE_INTELLIGENCE_BACKEND.md](docs/SOURCE_INTELLIGENCE_BACKEND.md).

The core personal workflow is implemented; verify your own installation with real accounts before relying on it. Queued AI work needs a running dispatcher. Remaining reliability and usability work includes OCR, per-agent resumability, reliable Meta token refresh, stronger spending controls, preview/export parity and backup/restore verification. Organization/team permissions, client portals and billing are optional extensions, not requirements for personal use. See [CURRENT_ROADMAP.md](docs/CURRENT_ROADMAP.md).

Original source code: [old/](old/). More setup and endpoint details: [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

License: AGPL-3.0-only. See LICENSE.


## V25 provider-reported AI usage

The Results screen includes a per-client usage summary for OpenRouter and OpenAI image generation. It records response-provided token counts and **nullable** reported USD costs; missing costs are not treated as zero. The owner-scoped read API is backed by immutable, server-written ledger entries. Configure the private `SUPABASE_SERVICE_ROLE_KEY` on all API/worker hosts to record observations. The database migration `0017_ai_provider_usage.sql` must be applied before deploying the endpoint. Usage reports are **not guaranteed complete, not invoices, and not currency spending caps**. See [docs/AI_PROVIDER_USAGE.md](docs/AI_PROVIDER_USAGE.md).

## V24 AI request safeguards

The application API reserves PostgreSQL-backed per-client and per-owner request quota before synchronous AI calls, while the existing queue RPC reserves capacity for asynchronous work. A 429 response means a rolling quota was reached; failed reservations block external AI calls. These counters are not a monetary spending cap. Deploy migration `0016_ai_request_budgets.sql` before the V24 API code. See [docs/AI_REQUEST_BUDGETS.md](docs/AI_REQUEST_BUDGETS.md).
