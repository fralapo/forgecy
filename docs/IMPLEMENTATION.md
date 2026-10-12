# Forgecy V11 implementation notes

## Setup
1. Run migrations 0001 and 0002 IN ORDER on a fresh Supabase project.
2. Configure .env.local. Never expose OpenRouter, OpenAI, Meta secret or token encryption key to the browser.
3. Enable Supabase email OTP/magic link and callback URL /auth/callback.
4. For new hosting: deploy Next.js on Vercel and provision Supabase Postgres/Auth/Storage separately (no Docker).
5. Real AI work requires OPENROUTER_API_KEY; UI must show an error, not demo text, when absent.
6. For Meta, register a verified app and configure META_* and OAuth redirect exactly; review required permissions.

## Tenant isolation
Every client is owned by one Supabase Auth user. Child tables use owner-scoped RLS and server validates ID. Do not use the service-role key for ordinary application requests.
The upload bucket is private and each path starts with the client UUID. Never expose raw connected Meta tokens.

## Lead workflow
1. User creates client and adds sources and verified offers.
2. Optional website import is disabled until ENABLE_WEBSITE_INGEST=true and **network egress rules** are applied.
3. Source/offer changes invalidate approved dossiers. Generate a new draft, inspect source attribution, approve.
4. Leader can answer questions in scoped chat; campaign work calls Analyst -> Strategist -> Copywriter/Art Director -> Brand Guard.
5. Handoffs are in agent_events; the proposal is in missions. Approval via one database transaction creates campaign and static content.
6. Author can edit content; editing an Instagram original invalidates its LinkedIn adaptations. Updating offers invalidates linked content.
7. Historical campaigns and measured social snapshots may guide new strategy, but **never invent metrics**.

## Explicit limitations / next production hardening
- Agent missions run synchronously through bounded AI calls: move to a durable managed job queue for high-volume/background workloads.
- Live website ingestion needs a container/network egress boundary, crawling budgets, robots and legal review, plus application-side DNS pinning.
- PDF/DOCX uploaded files are stored privately but automatic document extraction is not yet implemented; paste text into source notes for AI use.
- Instagram integration depends on Meta review and supported professional accounts. No analytics are simulated server-side.
- Generate images only on explicit request and track API costs; moderation and human approval remain essential.
- Add observability, distributed rate limiting, billing budgets, background token refresh, MFA and collaborative organization roles before selling as SaaS.
- Production content publishing to Instagram/LinkedIn is not included. Static content only, no video/reel workflow.
- Old legacy app is preserved as the Git tree under old/, not migrated. Historical database content must be migrated separately if needed.
- Regression testing with real Supabase and API credentials is required. No claim of live-integration testing without credentials.

## User experience
User chooses a client from a profile-like switcher at the sidebar bottom. The primary tabs are Today, Knowledge, Offers, Projects, Results. A persistent right-side Leader chat handles intent and makes proposed changes explicit. Each campaign groups brief, strategy, editorial plan, Instagram and LinkedIn adaptations, revisions and outcomes.
