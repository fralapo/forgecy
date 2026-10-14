# STORICO — Local-first workspace and Drive sync

> Il piano originario includeva un login OAuth Drive che è stato rimosso. La soluzione corrente è export/import e backup locali sincronizzati dal client cloud desktop; non seguire più le attività OAuth riportate sotto.

## Delivery

- Replaced the hosted data boundary with versioned SQLite schema, local file storage, machine-local owner identity and a persistent worker.
- Removed remote login, service credentials, hosted dispatcher, backend package/configuration, migrations and PostgreSQL CI.
- Added machine-local OpenRouter model preferences, local provider usage records and quota tracking.
- Added portable ZIP export/import using a SQLite backup image, asset hashes, integrity checks, bounded paths and pre-restore copies. Social access tokens are removed from archives and marked for reconnection on the destination computer.
- Added Google desktop OAuth with PKCE, loopback callback, `drive.file`, keyring storage with a private-file fallback, manual immutable snapshots, branch discovery and explicit conflict resolution.
- Rewrote setup, architecture, security, source, job and provider guides for the local application.
- Added CI for `npm ci`, typecheck, lint, tests and production build.

## Validation

`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and a temporary-directory local server smoke test passed on the available macOS ARM64 environment. CI targets Node 22.18. The local shell has Node 22.14, which emits the expected `engines` warning; use Node 22.18 or later for supported development.

The OAuth consent setup described in the original plan was never adopted as the supported user flow and is superseded by Drive Desktop folder synchronization. No Google OAuth client ID is needed by the current application.
