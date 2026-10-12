# Forgecy V11 — backend & deployment reference

## Design contract

The active client is chosen with the bottom-left switcher (mobile: account selector). Core views are **Today, Knowledge, Offers, Projects and Results**. A persistent Leader chat recognizes a natural-language request, asks agent specialists for structured results and prepares approval-required proposals.

Flow: client → sources/offers → current-state dossier → human approval → goal → multi-agent strategy → proposed campaign → approval → Instagram static + LinkedIn adaptations → measured results → future learning.

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

Run migrations 0001_init.sql, 0002_invariants.sql, 0003_knowledge_versions.sql and 0004_content_approval.sql **in that order** using the Supabase SQL Editor.

Postgres RLS applies to all client-owned records. Every source/profile/offer change bumps the client's knowledge revision and marks its dossier stale. A dossier can only be approved if it matches the current revision. A product edit invalidates linked assets. Editing an approved carousel resets it to draft; editing the Instagram original invalidates LinkedIn variants. Revalidation returns stale content to draft, not to approved.

The mission approval transaction locks the proposal, checks dossier/offer ownership and commits the campaign plus all its content atomically.

## Key routes

- GET/POST /api/workspace/clients — list/create clients.
- GET/PATCH /api/workspace/clients/:clientId — detail/updates.
- POST /api/workspace/clients/:clientId/sources — add supplied source notes.
- POST /api/workspace/clients/:clientId/upload — private file storage.
- POST /api/workspace/clients/:clientId/website — guarded HTTPS import (disabled by default).
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

1. Move long AI jobs to a durable managed queue with retries, concurrency controls, streaming and cost caps.
2. Extract and index text from uploaded PDF/DOCX/images before feeding them to AI; current extraction covers text, Markdown and CSV.
3. Use network egress isolation, crawl budgets and URL/robots policy before enabling the website import.
4. Complete and live-test Meta app verification, OAuth, token renewal, account disconnect and permitted Instagram insight fields.
5. Implement richer visual editor/templates, full QA and real image/document acceptance tests.
6. Add organization memberships, collaborative reviewer roles, cost reporting, observability, backups and migration of any old stored customer data.
7. Add social publishing or scheduled posting only if desired; no videos/reels.
8. Test full user journeys on a real Supabase instance and provider accounts; CI checks schemas and builds but is not external API integration certification.

The temporary Postgres Docker container used by GitHub Actions is strictly a test service, not a runtime requirement.

Original application code remains in old/ and the original Git history.
