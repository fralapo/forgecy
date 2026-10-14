# Forgecy local-first and Google Drive sync Implementation Plan

> **For agentic workers:** Implement inline in the approved `codex/local-first-drive-sync` worktree. Work in order, run the listed checks after each phase, and commit each independently verifiable phase.

**Goal:** Remove the hosted Supabase dependency and run Forgecy on a private local SQLite workspace with optional Google Drive snapshot sync.

**Architecture:** Keep the existing HTTP/UI behavior while replacing its database boundary with a server-only SQLite adapter, local file storage, and local owner identity. Move queued work into a persistent local worker. Add portable, immutable Drive snapshots with ancestry metadata and conflict preservation; never synchronize the live SQLite file. Remove obsolete hosted auth, migration, CI, and setup code only after replacement behavior passes.

**Tech Stack:** Next.js 16 / Node.js, SQLite via `better-sqlite3` (pin a release compatible with the repository's Node 22 baseline and verify on macOS ARM64), Google Drive v3 API, OAuth 2.0 PKCE, Node crypto and filesystem APIs.

---

## File map

- `lib/local-db/`: SQLite connection, schema migrations, query adapter, business RPC equivalents, backup image.
- `lib/local-files.ts`: private local file operations that replace Supabase Storage.
- `lib/http.ts`, `lib/env.ts`, `lib/ai-model-settings.ts`, `lib/ai-usage.ts`, `lib/ai-request-budget.ts`, `lib/crawl-budget.ts`, `lib/knowledge-search.ts`, `lib/knowledge-retrieval.ts`, `lib/job-runner.ts`: replace hosted database/auth operations while preserving public behavior.
- `proxy.ts`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `app/api/jobs/dispatch/route.ts`: remove hosted login and cron worker; enforce loopback and origin guards; add local worker lifecycle.
- `app/api/sync/**`, `lib/sync/**`, `app/workspace/**`, `components/**`: expose Drive connection, snapshot sync state, restore/conflict handling, and export/import actions.
- `tests/unit/**`, `tests/local-db/**`, `tests/sync/**`, `tests/repository-invariants.test.mjs`: exercise local schema, compatibility queries, backup/archive validation, and conflict graph behavior.
- `.env.example`, `README.md`, `docs/LOCAL_SETUP.md`, `docs/IMPLEMENTATION.md`, provider/job/search docs, `.github/workflows/verify-v11.yml`, `package.json`, `next.config.ts`: document and verify a Supabase-free installation.
- `supabase/**`: delete after migration/export path and replacement coverage are in place.

## Task 1: Local SQLite foundation

1. Pin a SQLite driver against the supported Node range; add Node typings and configure Next to keep the native package external to route bundles.
2. Add versioned SQLite migrations for the current business schema, replacing `auth.users` references with a single local owner ID, PostgreSQL-only types with JSON text/SQLite types, and FTS with SQLite FTS5.
3. Open the database below the OS user-data directory (with a documented `FORGECY_DATA_DIR` override), enable foreign keys, WAL, a bounded busy timeout, and restrictive directory/file permissions.
4. Implement the minimum `.from()` query-builder behavior currently used by the app (select/insert/update/delete/upsert, eq/in/order/limit, single/maybeSingle) and explicit JavaScript RPC equivalents for every current database function. Use transactions for state transitions and job leases.
5. Implement local file storage with validated client-relative paths and size checks; update the existing storage call sites.
6. Add tests for migrations, foreign keys, JSON round-trip, query operations, one-owner boundaries, RPC state transitions, and process restart persistence.

## Task 2: Local identity, request security, and persistent jobs

1. Replace `auth()` with the local owner context and remove account login/callback UI.
2. Keep the request mutation guard and reject non-loopback `Host`/forwarded-host requests; make the start command bind to `127.0.0.1` by default.
3. Replace hosted `CRON_SECRET` dispatch with a local polling worker started once per server process, using SQLite lease tokens and restart recovery.
4. Move model preferences and usage/budget bookkeeping into SQLite. Keep provider keys in local-only configuration and encrypt Meta tokens with a machine-local key.
5. Verify job idempotency, leases after a restart, stale approval guards, API origin behavior, and no remote listener.

## Task 3: Portable archive and migration bridge

1. Use the SQLite online backup API to make a consistent snapshot while the app is open, then package the database and referenced local assets with a versioned manifest and hashes.
2. Validate archive size, entry count, paths, format version, database integrity, foreign keys, references, and every asset hash before restore.
3. Restore only into a fresh workspace and atomically switch the active database after validation succeeds.
4. Provide a one-time legacy export/import procedure for existing Supabase users, without keeping Supabase in the runtime package. Document that the configured personal project currently has no business rows or stored assets.
5. Test round trips, malformed archives, path traversal, missing assets, unknown versions, and interrupted restore.

## Task 4: Optional Google Drive snapshots

1. Add local OAuth client configuration, PKCE state/verifier, loopback callback, `drive.file` scope, refresh-token persistence in the OS credential store where available, and disconnect/revoke behavior.
2. Create a visible `Forgecy` Drive folder and immutable snapshot files. Add app properties for format version, snapshot hash, parent hash, and device ID; discover branch heads from those immutable records.
3. Implement startup/manual/idle sync with hash verification, exponential retry for transient Drive errors, and explicit `needs-auth`, `offline`, `in-sync`, and `conflict` states.
4. On divergence, preserve the local workspace and every remote branch as named conflict copies; require an explicit choice before restoring one. Never auto-merge records or overwrite a snapshot.
5. Add deterministic tests with a fake Drive API for OAuth state, retries, idempotent upload, linear ancestry, offline divergence, and conflict restore.
6. Document Google Cloud configuration, consent-screen publishing status, the seven-day refresh-token expiry of external OAuth apps left in Testing, and the app's limited `drive.file` access.

## Task 5: Supabase removal and release verification

1. Remove Supabase imports from application, proxy, tests, scripts, CI, and docs; remove Supabase packages, credentials, migrations, and remote worker deployment instructions.
2. Update `README.md`, local setup, security docs, and `.env.example` for local-only operation and optional Drive setup.
3. Run tests, lint, typecheck, production build, and a clean-checkout smoke test without any Supabase environment variables.
4. Search tracked files for Supabase runtime setup references and verify no provider or OAuth secret enters an exported/Drive archive.
5. Once runtime independence is proven, export the personal project's metadata and pause the Supabase project if the connected controls still permit it. Attempt deletion only through an explicitly authorized control for the matching project.

## Execution notes

- Work inline because the user requested autonomous execution and this checkout is already the dedicated branch worktree; no subagents are dispatched.
- Commit the foundation, local runtime, sync, and removal phases separately so each checkpoint is reviewable.
- Do not delete or pause the Supabase project until the app runs and the upgrade/export path is verified. The connected Supabase controls previously exposed pause/restore, not delete, and the installed CLI account did not list this project.
- Drive revisions are not the retention strategy: immutable Forgecy snapshots remain separate files with explicit ancestry and hash validation.
