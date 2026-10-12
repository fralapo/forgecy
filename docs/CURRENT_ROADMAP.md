# Forgecy — roadmap, operational gaps and acceptance criteria

This document tracks **the development branch** `feature/source-intelligence-backend` (PR #91). Features are not considered deployed merely because their code exists or CI passes.

## Implemented in the development branch

- Supabase Auth and RLS on per-client data, private original uploads, typed Next.js endpoints and strict TypeScript CI.
- Multi-page guarded HTTPS acquisition with `robots.txt`, bounded optional sitemap discovery, DNS pinning, same-origin restrictions and SHA-256 deduplication. **Disabled by default** until egress firewall is configured.
- Text/PDF (text layer)/DOCX/CSV/Markdown extraction and private source storage.
- Real OpenRouter dossier generation with JSON Schema, an evidence report and source quote checks; user approval gates.
- Client-specific PostgreSQL full-text search; Leader grounding with retrieved document excerpts.
- Distinct versioned strategic blueprints, goals/KPIs, roadmaps and human approval.
- Basic durable `ai_jobs` queue with owner verification, DB quotas, worker leases, retry counts and UI progress. **Requires scheduler + privileged backend secrets**.
- Staged agents: Analyst → Strategist → Creative → Brand Guard → Leader, with audit events and approval-required proposed campaigns.
- Instagram Graph authorization skeleton, optional per-media insights, separate account observations, actual-data dashboards with absent values preserved.
- Static Instagram and LinkedIn creation, shared semantic slide layouts, safe edit preflight, undo/redo, PNG/PDF/TXT exports.
- Editorial calendar entries linked to a specific client, with manual status changes.
- Authenticated Markdown dossier/strategy exports and CSV social export; no synthetic metrics.
- GitHub Actions checks: TypeScript, unit tests, SQL migrations, RLS smoke checks and production build.

## Production blockers — P0

1. **Staging acceptance**: deploy to an isolated environment and test with real Supabase user accounts, two genuinely separate clients, authorized site content, document uploads and OpenRouter API credentials. CI does not perform external API calls.
2. **Website networking**: enforce public-only network egress at the infrastructure layer before enabling the crawler; verify the new PostgreSQL crawl reservations in staging, keep the egress firewall disabled-by-default, and add DNS/redirect penetration tests. Shared client/owner budgets are implemented in stacked development PR.
3. **Worker deployment**: configure scheduler credentials and hosted function timeout. Verify lease recovery and duplicate control under two concurrent workers. Split long missions into resumable steps; current queue has coarse job-level checkpoints.
4. **Security and access**: external security review of SECURITY DEFINER RPCs, RLS and all authenticated mutations; add CSRF/origin policy where appropriate, upload file scanners, audit tamper protection, application rate limits and secret rotation.
5. **Backup/restore**: scheduled Supabase backup plan, restore drills, retention policy for uploaded documents and customer data deletion.
6. **AI controls**: per-tenant currency/token spending ceilings with hard server-side rejection; provider timeouts, failure categories, alerting and cost audit. Current job-count quotas do **not** bound currency spending.
7. **Meta live certification**: validate professional account eligibility, permissions/review, OAuth, token refresh, disconnect/revocation, permitted media/insight metrics, quotas and time-window differences.

## Product improvement — P1

1. Real searchable knowledge wiki with entities, conflict resolution, semantic retrieval where source corpus size warrants it, periodic source refresh and diff review.
2. OCR for scanned PDFs/images, isolated extraction workers, bounded PDF rendering, antivirus and protections against malicious documents.
3. True orchestrator graph: resumable specialist tasks, parallel stages when independent, review/retry by individual agent, independent quality critic and human intervention.
4. Rich WYSIWYG design: art-direction library, custom brand typography with authorized fonts, editable layers and parity checks between preview, PNG and PDF; avoid hiding text overflow.
5. Production factories by platform inspired by `fabbriche-template`, keeping brand identity separate from channel recipes. Current supported assets are **static Instagram and LinkedIn**.
6. Social analytics with comparable periods, authorized insights, data freshness indicators, metric definitions and an explicit KPI attribution model.
7. Client approval portal, collaborator seats, agency/org memberships, fine-grained reviewer privileges and notifications.
8. Publishing and scheduling only after social platform permissions and customer authorizations are validated.
9. Human-editable strategic blueprint revisions with structured diffs, approval history and KPI experiments.

## Optional scope decision — P2

Video/Reels, audio production, complex automation, white-label agency billing and competitive SEO/GEO audits require separate product decisions and budgets. The current static production flow does not pretend to generate videos.

## Acceptance checklist for one real customer

- [ ] Two user accounts cannot read or alter each other's company data through frontend, REST or RPCs.
- [ ] Importing a real allowed site yields page-level links and hashes; denied/unsafe destinations cannot be fetched.
- [ ] Uploading a PDF and DOCX extracts only supported textual evidence; scanned images report their unsupported status.
- [ ] The dossier contains real quote-linked claims, unknowns and approval status.
- [ ] Updating a source invalidates existing dossier and strategy and blocks old campaign approvals.
- [ ] Worker retries do not duplicate completed missions; user can cancel a queued job.
- [ ] A real Instagram Professional account connects, syncs and exports known real fields. Missing fields remain blank.
- [ ] Carousel can be edited, approved, rendered and exported consistently with brand settings.
- [ ] Operational errors are visible in logs and user-facing status without exposing secrets.
- [ ] A new deployment and a disaster recovery restore can reproduce the customer workspace.

## Engineering method

Inspired by the planning/testing/review principles in [Everything Claude Code (ECC)](https://github.com/affaan-m/ecc) without importing external hooks indiscriminately:

`scope → failing test → minimal implementation → code review → CI → security review → docs → staged release`.

Work in small pull requests where possible; consolidate the current broad PR before merging it. Keep production migrations strictly forward-only and tested against existing data.
