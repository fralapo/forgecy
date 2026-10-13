# Forgecy — personal-use roadmap and acceptance criteria

Updated 13 October 2026. This describes the current application on `main`, including V25. Code and passing CI do not certify an individual installation's external services.

## Intended use

Forgecy is an open-source personal project: run it locally with your own Supabase project and your own API keys. One personal installation is enough; separate staging and production projects are optional. Multiple client/brand profiles organize your work. They do not imply a commercial SaaS or collaborative organization model.

The Next.js server runs on your computer. Auth, database and files live in your configured Supabase project; enabled AI and Meta integrations contact their respective providers. Local execution is not offline processing. See [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Implemented

- Supabase email authentication, owner/client isolation with RLS and private source/asset storage.
- Bounded HTTPS website acquisition, provenance, hashes and shared crawl reservations. Crawling remains disabled by default until outbound network isolation is configured.
- Text, Markdown, CSV, text-layer PDF and DOCX extraction; PostgreSQL full-text source/excerpt search.
- Structured AI dossiers, matching source quotations, approval/versioning and invalidation when knowledge changes.
- Separate approved strategic blueprints with positioning, goals/KPIs and 30/60/90-day roadmaps.
- Persistent AI jobs with ownership checks, quotas, retries, renewable leases and fencing; sequential specialist hand-offs and human-approved campaign proposals.
- Static Instagram/LinkedIn editor, layouts, reorder/duplicate, undo/redo, PNG/PDF/TXT and Markdown/CSV reports; a manual editorial calendar.
- Instagram authorization and measured snapshots/optional media insights, preserving unknown values.
- Shared AI request quotas (0016) and per-client provider-reported tokens/nullable USD observations (0017). Neither is a guaranteed monetary cap.
- GitHub Actions: TypeScript, lint, Node tests, PostgreSQL migrations/RLS and Next.js build.

## First priority — a usable personal installation

1. Make fresh installation repeatable: supported Node, ordered migrations 0001–0017, private environment file, email callback and local start instructions.
2. Validate the complete journey with your own account: sources/offers → dossier → approval → strategy → approval → mission → proposal → approval → edit/export. Use disposable sample content before important work.
3. Keep queued work operational while the computer is on. Test retry/recovery and concurrent dispatch; show configuration failures clearly. Finer per-agent resumability remains an improvement, not a prerequisite to installing the app.
4. Check generated files visually, including long text, accents, symbols and images. Preview, PNG and PDF use different rendering paths; PDF wrapping may truncate lines and unsupported characters are filtered.
5. Verify spending information against provider records. Handle missing usage explicitly and set upstream provider spending limits when available; add alerts/reconciliation before treating local estimates as complete.
6. Back up the personal Supabase database and private files before upgrades; verify restoration and document customer/source deletion and retention.
7. Enable integrations individually. Keep website ingestion off without network isolation. Test Meta permissions, token expiry/reconnect and actual insights before depending on them.

## Next improvements — reliability and creative workflow

- OCR for scanned documents, safer isolated extraction and stronger malicious-file defenses.
- Per-agent resume/retry, cancellation of running calls and error visibility.
- Shared rendering, overflow checks, authorized custom fonts and a richer asset/template library.
- Source refresh/diffs, contradictions, fact timestamps and semantic retrieval when corpus size warrants it.
- Editable strategic revisions and comparable social periods, freshness and KPI definitions.
- Optional publishing/scheduling after platform permissions and account authorization are verified.

## Optional extensions

Organizations, collaborator/reviewer seats, a client portal, notifications, hosted multi-user operation, billing and white-label features are not personal-use release blockers. Video/Reels, audio and SEO/GEO research require separate scope decisions. The current flow supports static Instagram and LinkedIn.

If you expose an instance publicly, additionally assess external security review, rate limits, secret rotation, worker hosting limits, monitoring and recovery. Do not disable RLS, authentication or origin checks to simplify local setup.

## Personal acceptance checklist

- [ ] A clean checkout installs with the documented Node version and starts on loopback.
- [ ] Migrations 0001–0017 and both private buckets are present in your Supabase project.
- [ ] Email sign-in returns to the local callback and opens your workspace.
- [ ] Anonymous access is denied; separate accounts cannot access each other's profiles (use disposable accounts when testing this).
- [ ] Text/PDF/DOCX uploads and source search work; scans clearly report limitations.
- [ ] Dossier quotes are inspectable; approvals and source-change invalidation work.
- [ ] A dispatched job produces a reviewable strategy/campaign and retries without duplicate completed records.
- [ ] Static content can be edited and exported legibly with expected brand settings.
- [ ] Usage records preserve unknown costs; provider bills remain authoritative.
- [ ] Optional Instagram and website ingestion work only after their prerequisites are configured.
- [ ] Data and private files can be backed up and restored.

Use sample records for validation; the SQL suites under `tests/sql/` are designed for a disposable test database and must not be run against your personal data project. CI does not execute real provider calls.

## Maintenance

Prefer small changes, green CI and forward-only migrations. Back up existing data before upgrades; apply only migrations not already applied. A separate test project is useful for risky changes but is not required for ordinary personal use. Archived `old/` code and data are not automatically migrated.
