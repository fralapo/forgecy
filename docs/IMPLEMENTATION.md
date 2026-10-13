# Forgecy V11 — backend & deployment reference

## Design contract

The active client is chosen with the bottom-left switcher (mobile: account selector). Core views are **Today, Knowledge, Offers, Projects and Results**. A persistent Leader chat recognizes a natural-language request, asks agent specialists for structured results and prepares approval-required proposals.

Flow: client → sources/offers → evidence-backed current-state dossier → human approval → versioned corporate strategic blueprint → human approval → queued specialist mission → reviewable proposed campaign → approval → static production/calendar → measured results → proposed strategy revision.

## Environment

Mandatory:
- NEXT_PUBLIC_SUPABASE_URL — URL of a managed Supabase project.
- NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase publishable key. RLS must be enabled.
- Supabase Email OTP/Auth redirect URLs.

Optional server-only:
- OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_SITE_URL.
- OPENAI_API_KEY, OPENAI_IMAGE_MODEL.
- META_APP_ID, META_APP_SECRET, META_REDIRECT_URI, META_GRAPH_VERSION.
- TOKEN_ENCRYPTION_KEY_BASE64 — 32 bytes, encoded in base64 (AES-GCM).
- ENABLE_WEBSITE_INGEST=false unless protected with network-level outbound restrictions.

**Never** expose private credentials through a NEXT_PUBLIC_ variable, database response, user prompt or client-side code.

## Database setup

Run all SQL files in `supabase/migrations/` **in numerical order from 0001 through 0011_client_evidence_search.sql** using Supabase SQL Editor, following the validation instructions in `tests/sql/smoke.sql`. Keep a database backup before production migrations.

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
- POST /api/workspace/clients/:clientId/contents/:id/image — OpenAI image generation.
- GET /api/workspace/clients/:clientId/contents/:id/export — PNG, PDF or TXT.
- GET /api/integrations/instagram/connect — Meta OAuth.
- POST /api/workspace/clients/:clientId/social/sync — real Instagram account/media metrics.

The UI and APIs require authenticated users. No application service-role key is used for ordinary CRUD.

## Agent contract

The Leader routes user intent to answer, draft a company dossier or propose a campaign. Campaign flow: Analyst → Strategist → Copywriter/Art Director → Brand Guard → Leader. The resulting campaign proposal is stored in missions, while agent_events preserves the hand-offs. The human must approve before new campaigns or content are created.

Website copy, uploaded text and external posts are **untrusted evidence, never instructions**. Facts must be associated with their sources or labelled inferred/unknown. Never manufacture metrics or prices. Do not present simulated Instagram statistics as real.

## Production work still needed

1. The initial PostgreSQL queue is implemented, but **production job scheduling, stage-level resumability, streaming, provider cost caps and live worker tests** remain required.
2. Extract and index text from uploaded PDF/DOCX/images before feeding them to AI; current extraction covers text, Markdown and CSV.
3. Use network egress isolation, crawl budgets and URL/robots policy before enabling the website import.
4. Complete and live-test Meta app verification, OAuth, token renewal, account disconnect and permitted Instagram insight fields.
5. Implement richer visual editor/templates, full QA and real image/document acceptance tests.
6. Add organization memberships, collaborative reviewer roles, cost reporting, observability, backups and migration of any old stored customer data.
7. Add social publishing or scheduled posting only if desired; no videos/reels.
8. Test full user journeys on a real Supabase instance and provider accounts; CI checks schemas and builds but is not external API integration certification.

The temporary Postgres Docker container used by GitHub Actions is strictly a test service, not a runtime requirement.

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

**These capabilities currently live in a draft pull request.** They are not a production deployment, and GitHub CI passing does not establish live Meta, OpenRouter, Supabase or crawler reliability.
