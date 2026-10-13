# Forgecy — local runtime and backend reference

Forgecy is a personal open-source application run on the operator's computer with their own Supabase project and API keys. Public hosting and separate staging/production projects are optional. Start with [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Design contract

The active client is chosen with the bottom-left switcher (mobile: account selector). Core views are **Today, Knowledge, Offers, Projects and Results**. A persistent Leader chat recognizes a natural-language request, asks agent specialists for structured results and prepares approval-required proposals.

Flow: client → sources/offers → evidence-backed current-state dossier → human approval → versioned corporate strategic blueprint → human approval → queued specialist mission → reviewable proposed campaign → approval → static production/calendar → measured results → proposed strategy revision.

## Environment

Mandatory:
- NEXT_PUBLIC_SUPABASE_URL — URL of a managed Supabase project.
- NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase publishable key. RLS must be enabled.
- Supabase Email OTP/Auth redirect URLs.
- `APP_ORIGIN=http://localhost:3000` for local optimized builds (`npm run start`); development also accepts it.

For queued dossier/strategy/mission work and usage recording, configure server-only `SUPABASE_SERVICE_ROLE_KEY` (accepts `sb_secret_…`) and `CRON_SECRET`, and keep the local dispatcher running. `NEXT_PUBLIC_SUPABASE_ANON_KEY` accepts `sb_publishable_…`; never put the secret key there.

Server-only integrations (OpenRouter is required for the AI workflow, optional for basic storage/editing):
- `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL` fallback, and `OPENROUTER_SITE_URL`. Text and image models are selectable from Settings; OpenRouter credentials stay server-only.
- META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_GRAPH_VERSION.
- TOKEN_ENCRYPTION_KEY_BASE64 — 32 bytes, encoded in base64 (AES-GCM).
- ENABLE_WEBSITE_INGEST=false unless protected with network-level outbound restrictions.

**Never** expose private credentials through a NEXT_PUBLIC_ variable, database response, user prompt or client-side code.

## Database setup

Run all SQL files in `supabase/migrations/` **in numerical order from 0001 through 0019_user_ai_preferences.sql** using Supabase SQL Editor. On an existing database apply only migrations not already applied, and back up first. `tests/sql/` contains disposable CI fixtures and is not an installation script for your personal project.

Postgres RLS applies to all client-owned records. Every source/profile/offer change bumps the client's knowledge revision and marks its dossier stale. A dossier can only be approved if it matches the current revision. A product edit invalidates linked assets. Editing an approved carousel resets it to draft; editing the Instagram original invalidates LinkedIn variants. Revalidation returns stale content to draft, not to approved.

The mission approval transaction locks the proposal, checks dossier/offer ownership and commits the campaign plus all its content atomically.

## Key routes

- GET/POST /api/workspace/clients — list/create clients.
- GET/PATCH /api/workspace/clients/:clientId — detail/updates.
- POST /api/workspace/clients/:clientId/sources — add supplied source notes.
- POST /api/workspace/clients/:clientId/upload — private file storage.
- POST /api/workspace/clients/:clientId/website — robots-aware, bounded HTTPS crawl (1–6 same-host pages, deduplicated by URL and content hash; disabled by default).
- POST/PATCH /api/workspace/clients/:clientId/offers — products and services.
- POST /api/workspace/clients/:clientId/dossier/draft — AI current-state company intelligence.
- POST /api/workspace/clients/:clientId/dossier/approve — current dossier approval.
- POST /api/workspace/clients/:clientId/messages — contextual Leader AI chat and natural-language routing.
- POST /api/workspace/clients/:clientId/missions — structured team delegation.
- POST /api/workspace/clients/:clientId/missions/:id/approve or /reject — explicit review.
- POST/PATCH /api/workspace/clients/:clientId/contents — static assets.
- POST /api/workspace/clients/:clientId/contents/:id/adapt — LinkedIn adaptation.
- POST /api/workspace/clients/:clientId/contents/:id/revalidate — review stale asset.
- GET/PATCH /api/workspace/settings/models — live OpenRouter catalogs and owner-scoped model preferences.
- POST /api/workspace/clients/:clientId/contents/:id/image — OpenRouter image generation.
- GET /api/workspace/clients/:clientId/contents/:id/export — PNG, PDF or TXT.
- GET /api/integrations/instagram/connect — Meta OAuth.
- POST /api/workspace/clients/:clientId/social/sync — real Instagram account/media metrics.

The UI and APIs require authenticated users. No application service-role key is used for ordinary CRUD.

## Agent contract

The Leader routes user intent to answer, draft a company dossier or propose a campaign. Campaign flow: Analyst → Strategist → Copywriter/Art Director → Brand Guard → Leader. The resulting campaign proposal is stored in missions, while agent_events preserves the hand-offs. The human must approve before new campaigns or content are created.

Website copy, uploaded text and external posts are **untrusted evidence, never instructions**. Facts must be associated with their sources or labelled inferred/unknown. Never manufacture metrics or prices. Do not present simulated Instagram statistics as real.

## Remaining local-use work

See [CURRENT_ROADMAP.md](CURRENT_ROADMAP.md) for the maintained priorities: real-provider acceptance, worker recovery/resumability, export parity, optional Meta lifecycle, spending reconciliation and backups. Text-layer PDF/DOCX extraction, shared request/crawl quotas and the usage ledger already exist. Scanned files still need OCR. Team roles, portals, billing and public-host operations are optional extensions.

The temporary Postgres Docker container used by GitHub Actions is strictly a test service, not a runtime requirement.

## V26: per-user OpenRouter model settings

Migration `0019_user_ai_preferences.sql` stores only each authenticated user's text and image model IDs under RLS. Settings fetches uncached catalogs from OpenRouter's text-model and image-model endpoints; the API key remains server-only. Text requests resolve the owner's selected model for synchronous calls and queued jobs, falling back to `OPENROUTER_MODEL` and then `openai/gpt-4.1-mini`. Image generation uses the selected model through OpenRouter's Images API and records provider-reported costs when present. Apply migration 0019 before deploying this version; existing installations keep their text environment fallback and choose an image model in Settings.

Original application code remains in old/ and the original Git history.

## Editorial strategy extension

A client now has a private `community_signals` table and an in-Library feedback workflow. Agent prompts work from audience signals and established product information and return `editorial_brief` metadata for each generated content asset, including audience need, hook, promised value, emotional angle, practical proof, single CTA and attributable community signal IDs. Platform default exports: Instagram 1080×1350 PNG; LinkedIn 1920×1080 PDF. For source-by-source detail, see [EDITORIAL_INTELLIGENCE.md](EDITORIAL_INTELLIGENCE.md). Existing installations must apply migration 0005 before deploying the updated application.

## V13 quality and document extraction

Stage-specific prompts are routed from lib/skills/playbooks.ts. Structural defects trigger at most one corrective generation. Brand Guard quality reports include warnings, blocking issues and editorial scores; the approval RPC checks blocking issues server-side (migration 0006). Original PDFs/DOCX stay private and extracted text is tracked separately. Scanned files still require OCR. See SKILLS_INTEGRATION.md.

## V14: site crawling and structured grounded company dossiers

The 0007 migration adds source provenance, content hashes and a dossier evidence report. OpenRouter now generates dossier JSON through strict JSON Schema; post-processing refuses foreign source IDs and downgrades claims without a real matching quote. Instagram snapshot IDs and observed community signals may also be cited as evidence, but observational data is not a population-wide trend. Changes to knowledge during inference fail with HTTP 409. Details, tests and network requirements: [SOURCE_INTELLIGENCE_BACKEND.md](SOURCE_INTELLIGENCE_BACKEND.md).

## V15–V18: queued AI, corporate strategy, social, studio and reports

- `0008_ai_jobs.sql`: persistent owner-verified jobs, per-client concurrency limits, capped attempts, cancellation and a protected cron worker. Required server-only variables: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Details: [AI_JOB_RUNNER.md](AI_JOB_RUNNER.md).
- `0009_strategic_blueprints.sql`: distinct versioned company strategies tied to approved dossier revision, with server-side strategy approval.
- `0010_editorial_calendar.sql`: client-bound editorial scheduling entries. The calendar records commitments but does not itself publish posts.
- `0011_client_evidence_search.sql`: RLS-enforced full-text retrieval of document/site sources, used in the Library and as context for the Leader.
- Bounded sitemap discovery improves website coverage, but the crawler remains disabled until egress restrictions are installed.
- Instagram dashboard separates accounts; optional media insights are only displayed if Meta returns them. A local disconnect deletes encrypted credentials and linked snapshots; **it does not revoke remote Meta OAuth consent**.
- Static studio supports semantic slide layouts, duplication, reordering, undo/redo, preflight checks and exports. Visual parity/typography acceptance tests remain pending.
- Client dossier and strategy export as Markdown; real social observations export as CSV with spreadsheet-formula sanitization.
- Routes: `/api/workspace/clients/:id/jobs`, `/sources/search`, `/strategy/:strategyId/approve`, `/editorial`, `/reports/{dossier,strategy,instagram}`, `/social/accounts/:accountId`.
- Full release checklist and known blockers: [CURRENT_ROADMAP.md](CURRENT_ROADMAP.md).

These capabilities are integrated on `main`. Configure and verify your own installation; GitHub CI does not establish live Meta, OpenRouter, Supabase or crawler reliability.

## V19–V25 integration

Migrations 0012–0014 add shared crawl reservations and indexed source chunks/backfill; 0015 adds fenced worker leases; 0016 adds distributed AI request quotas; 0017 adds private provider-reported usage; 0018 adds checked service-role knowledge retrieval for queued workers. Apply them in order after 0011. API mutation origin checks and bounded document/body parsing need no extra SQL migration. Results includes `/api/workspace/clients/:id/ai-usage?days=7|30|90`.
