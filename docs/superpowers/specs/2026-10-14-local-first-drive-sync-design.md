# Forgecy local-first and Google Drive sync design

## Goal

Make Forgecy a single-user local application that runs without Supabase, stores its working data on the current computer, and can optionally synchronize that data with the user's Google Drive when moving between computers.

## Current context

Forgecy is a Next.js application that currently uses Supabase Auth, Postgres, Storage, RLS, RPC-backed AI jobs, and a service-role worker. Roughly 80 application and library files call Supabase directly or through helpers. Its 20 business tables and one preference table encode important constraints, invalidation rules, search indexes, request limits, worker leases, and usage records; those behaviors need local equivalents.

The configured Supabase project was inspected on 2026-10-14. Exact counts found zero rows in all 21 Forgecy public tables and zero objects in both Forgecy Storage buckets. It contains one Auth user, used for local sign-in. No Forgecy workspace data or uploaded files need migration for this project. Existing open-source installations may have data and need a portable export/import path before Supabase code is removed.

## Approved product direction

Forgecy runs as a local Next.js/Node process and binds only to loopback. Remove email login and make the local workspace available directly. Keep browser mutation protections, request limits, and the current data invariants. Move relational records to a local SQLite database and uploaded/generated files to a private directory in the operating-system application-data location. Run AI jobs in the local process with persistent job state and leases so long-running work remains recoverable after a restart.

OpenRouter, Meta, and other provider credentials remain machine-local. Store them in the local environment/configuration; never include them in Drive snapshots. AI model choices, usage history, saved social tokens, business records, and assets are local data and are included in user-controlled backups. Encrypt social-provider tokens at rest with a key that stays on that computer.

## Google Drive connection and synchronization

Google Drive is an optional sync and backup target, not the live database. Connect with Google's installed-app OAuth flow using PKCE and the narrow `drive.file` scope. Forgecy creates a visible `Forgecy` folder in the user's Drive and stores versioned portable snapshots there. OAuth refresh credentials remain only on the local computer.

Each snapshot is an atomic portable archive containing a consistent SQLite backup, its referenced assets, a format version, a parent revision, a device identifier, a creation time, and a content hash. Never upload the active SQLite file. The app exposes sync status and a manual sync action, checks Drive when it starts, and uploads a new snapshot after local changes settle.

When the remote head still matches the last revision this computer downloaded, publish the next snapshot and update the sync manifest. When another computer has published a different head, keep the local state and the remote snapshot as separate conflict copies and ask the user which copy to open or restore. Do not silently replace either copy or attempt row-level automatic merges. The supported workflow is alternating computers, with conflicts preserved if a device was used offline or the sync order was missed. Concurrent editing is out of scope.

Drive API change tokens may be used to avoid unnecessary full-folder scans, but correctness is based on the manifest and content hashes rather than notifications. The visible folder lets the user inspect, download, and back up snapshots manually. The hidden `appDataFolder` is not used.

## Local data boundary and security

There is one local owner; Supabase account IDs and row-level policies are removed. Database constraints and transactions replace database-enforced invariants. Preserve revision checks for stale dossiers and content, approved-state guards, unique job idempotency, upload signature checks, and content-size bounds.

The server binds to `127.0.0.1` for development and production starts. Requests that mutate state retain strict same-origin/CSRF checks. Public hosting and remote access are unsupported in this mode. Provider credentials, Meta tokens, and Google OAuth refresh tokens are excluded from portable archives. Meta tokens remain encrypted at rest locally.

## Migration and removal

Provide a versioned export/import format so users with an older Supabase-backed Forgecy can export records and files before upgrading. Import validates archive version, hashes, references, and size limits before writing into a new local database. The current project has no business records, so its personal conversion is an empty local workspace.

Remove Supabase packages, environment variables, SSR/browser clients, Auth pages and callback, PostgREST access, service-role worker, Storage paths, Supabase migrations, PostgreSQL-only CI, and setup documentation. Replace SQL integration coverage with SQLite migration, integrity, ownership-boundary, worker, archive round-trip, and conflict tests. Keep no Supabase runtime or hosted database requirement after the conversion.

Apply the work in independently verifiable phases:

1. Introduce local storage and job interfaces, implement SQLite schema/invariants, and move business routes and assets to disk while preserving behavior.
2. Remove Supabase Auth and switch the app to a loopback-only single-user workspace; run AI jobs locally.
3. Implement Drive OAuth, portable snapshots, alternating-device sync, conflict copies, and manual export/import.
4. Remove Supabase packages/configuration/migrations from the runtime and CI, update setup and security docs, and verify the final install from a clean checkout.
5. Verify the remote Supabase project is no longer needed, export its final metadata, then pause it. Project deletion is attempted only if the connected Supabase controls permit it; otherwise provide the exact dashboard path for the owner.

## Acceptance criteria

- A clean installation runs and creates/uses its local database without Supabase URL, keys, Auth, or a remote worker.
- All current workspace, AI, image, file, search, reporting, usage, and Meta workflows preserve their existing validation and approval behavior.
- The local app is unreachable from other LAN devices by default.
- A user can connect a Google account, sync to a visible Forgecy Drive folder, use a second computer after syncing, and recover a preserved conflict copy after offline divergence.
- A snapshot can be exported and imported with database relations and asset hashes intact; provider secrets are absent.
- README, local setup, implementation docs, `.env.example`, and CI contain no Supabase runtime setup requirement.
- Local checks and GitHub CI pass. The configured Supabase project is paused after the application no longer depends on it; it is deleted only if a supported authorized control is available.

## Trade-offs and alternatives

Local-only SQLite with manual portable backups is the simplest and works offline, but it does not synchronize computers. Pointing SQLite directly into a Google Drive Desktop folder avoids Drive OAuth but risks corrupted or conflicted live database files and depends on installing Google's sync client. The selected local SQLite plus Drive API snapshots approach supports the in-app connection the user requested, keeps normal work offline, and handles divergence by preserving both versions. It requires a Google OAuth desktop client configuration and does not provide real-time simultaneous collaboration.
