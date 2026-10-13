# Forgecy — implementation status (13 October 2026)

Forgecy is a personal open-source app run locally with the operator's Supabase project and API keys. It is not a Forgecy-operated SaaS. Separate staging and production environments are optional.

The current application includes the V14–V24 integration and V25 provider usage telemetry on `main`. The former branch/PR status in this document is obsolete; `old/` preserves the previous application rather than supplying features to the current runtime.

## Current functionality

Auth/RLS, private uploads, text/PDF/DOCX extraction, bounded website acquisition, source-attributed dossiers, indexed excerpt retrieval, approved strategic blueprints, queued specialist missions, approval gates, static Instagram/LinkedIn editing and export, editorial calendar, measured Instagram observations and provider-reported AI usage are implemented.

Website acquisition is disabled by default. AI needs your OpenRouter key; queued jobs also need the private Supabase key, a cron secret and a running local dispatcher. Images and Instagram are optional integrations. Usage telemetry is partial and does not impose a currency cap.

## Set up your installation

Follow [LOCAL_SETUP.md](LOCAL_SETUP.md). Apply all migrations **0001–0018**, configure local auth and `.env.local`, start the app on loopback, then start the dispatcher. Never run CI SQL fixtures against your personal project or put API keys in committed files.

## Evidence and limitations

CI checks TypeScript, lint, unit/invariant tests, PostgreSQL migrations/RLS and the production build. Each installation still needs a real sign-in, upload, approved dossier/strategy, queued campaign and visual export check with its own services. A successful merge is not evidence that your database was initialized or your providers connected.

Outstanding personal-use work includes per-agent resumability, scanned-document OCR, Meta token lifecycle, backup/restore verification, usage reconciliation and preview/export parity. Organization roles, collaboration portals and billing are optional extensions.

[CURRENT_ROADMAP.md](CURRENT_ROADMAP.md) is the maintained priority list; [IMPLEMENTATION.md](IMPLEMENTATION.md) documents backend contracts and endpoints. Avoid maintaining a second conflicting backlog here.
