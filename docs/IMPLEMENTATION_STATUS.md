# Forgecy — implementation status and remaining work (12 October 2026)

This is the engineering acceptance checklist for the live Next.js/Supabase app at the root of the repository, not the archived `old/` tree or a standalone HTML prototype.

## Completed on branch `feature/source-intelligence-backend`

- **Source Intelligence (0007):** bounded HTTPS same-host crawling with robots.txt, DNS pinning and disabled-by-default network acquisition; content hashes, provenance, grounded source quotations and strict OpenRouter JSON Schema dossiers.
- **Durable AI job queue (0008):** authenticated database enqueue, per-client quota (3 outstanding, 24 jobs per rolling 24 hours), exclusive leases, retries, idempotent job IDs, server-only service role, cron endpoint and queue-status UI. The worker must be explicitly configured: jobs do not run without a scheduler and secrets.
- **Measured Social Analytics:** per-account history and follower delta, sampled interactions, ranked posts, optional recent per-media reach/saves/shares with missing-value handling, and a way to consult the Leader.
- **Company Strategy (0009):** versioned blueprints generated only from an approved dossier, separate approval, 30/60/90-day roadmap, KPI baselines explicitly nullable, automatic stale invalidation, and campaign gates in routes and database. Campaign proposals are still reviewed by humans.
- **CI:** TypeScript, unit tests, PostgreSQL migration + RLS/invariant smoke tests, Next production build.

## Required to activate

1. Apply `supabase/migrations/0001` through `0009` in order in a staging Supabase project, test backup/rollback and then apply to production.
2. Configure Auth, `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` supporting strict JSON Schema.
3. For async AI, set private `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` (24+ characters); configure a trusted scheduler for `GET /api/jobs/dispatch`.
4. Enable public website ingestion only after implementing private-network egress blocking at the infrastructure layer; then set `ENABLE_WEBSITE_INGEST=true`.
5. For Instagram, complete Meta app review and test OAuth, token lifecycle, optional insight permission fields and client-specific account selection using a real professional account.
6. Test the full new-client journey: upload → crawl → dossier → review → strategy → approve → mission → propose → approve → export. CI is **not** live-provider certification.

## Backlog still not implemented

### P0 — Security and reliability
- Production egress firewall, **staging validation of shared per-owner crawl budgets (migration 0012)**, stronger RFC 9309 parser, JS crawling, controlled attachment quarantine and scanned-PDF OCR.
- Worker orchestration per agent step instead of one long job, full idempotent provider billing, per-client currency/token budgets and usage ledger, distributed rate limits, live progress/cancellation for running model calls.
- Observability, error alerts, backup/restore rehearsals, threat modeling and production penetration tests.

### P1 — Client intelligence and marketing
- Entity/fact graph with contradictions and fact timestamps, semantic indexing and document retrieval for large uploaded corpora; competitors supported by real external sources.
- Broader Meta Insights per account/media, scheduled synchronization, token refresh/reconnect/disconnect, permission-aware partial failures and attribution for campaigns.
- Approved editorial calendars with slots, scheduling conflicts, recurring content, real performance-to-strategy review cycles.

### P1 — Production
- Full layer-based creative editor and a shared preview/export renderer, visual asset library, template marketplace, layout overflow tests and bulk export.
- Adapt reusable concepts from MIT-licensed Vertica. Adapt the user-owned `fabbriche-template` patterns: per-brand tokens, multi-channel production and deterministic QC. Do not blindly copy its character/font/SFX assets without rights checks.
- Facebook delivery, client preview/review and external posting, if authorized and explicitly enabled.
- The current V11 scope **excludes Reel/video creation**; supporting it means an additional video pipeline, not a minor switch.

### P2 — Agency workflow
- Shared organizations, multiple team members, reviewer/customer roles, notifications, billing and contract workflows; encrypted provider credentials per workspace.
- SEO/GEO audits, customer onboarding automation and editable customer reports.

## Development method

Adopt the ECC-inspired cycle: plan → test → implement → review → verify → document. Never merge a failing branch or bypass QA gates; check a staging tenant's real data/permissions before turning on a new integration.

See `docs/SOURCE_INTELLIGENCE_BACKEND.md` and `docs/AI_JOB_RUNNER.md` for activation details.
