# Forgecy local-first workspace and Google Drive sync

## Goal

Run Forgecy as a private single-user app on the owner's computer. Keep the live database and files local, with optional manual transfer of versioned snapshots through the owner's Google Drive.

## Approved design

The Node server binds to loopback. SQLite is authoritative; files live in a private operating-system data directory. A local worker processes durable AI jobs. API keys and social/OAuth credentials remain on each computer and are excluded from portable archives. Model preferences, usage history, workspace records and assets remain local.

Google Drive is an optional snapshot store, never the location of the live SQLite file. Desktop OAuth uses PKCE, a random loopback port and the least-privilege `drive.file` scope. A portable ZIP contains a SQLite online-backup image, workspace assets and a versioned hash manifest. Snapshots are immutable files with parent hashes and device IDs. The user syncs before switching computers; diverging copies stay on Drive as separate branches and require an explicit choice. No simultaneous editing or automatic row merge is promised.

Import validates the complete archive before changing local data and preserves the pre-import workspace. It pauses the local job worker before replacing SQLite. Social tokens are scrubbed from archives and the user must reconnect the social account on a new computer.

## Delivery record

Implemented in the local-first migration: SQLite schema/versioning, local storage and worker, owner-only settings, live OpenRouter text/image catalogs, archive export/import, OAuth Drive connection, manual sync and branch conflict resolution. Local checks and production build pass. Live Google authorization still requires the owner to create a Desktop OAuth client and set `GOOGLE_DRIVE_CLIENT_ID` in `.env.local`.

The owner’s previous hosted project was checked during implementation and had no Forgecy workspace records or stored assets. The new runtime does not depend on that project. Its available control can pause it but cannot permanently delete it.

## Research

- Google's installed desktop app flow supports PKCE and a loopback IP callback. Refresh tokens need secure persistent storage. [Native app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- `drive.file` gives per-file access for files created by the app or explicitly opened/shared with it; it avoids broad access to the full Drive. [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- Google documents a seven-day refresh-token lifetime for external apps left in Testing when requesting scopes beyond basic profile. [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2)
- SQLite Online Backup creates a consistent point-in-time copy while the source remains available. [SQLite Backup API](https://www.sqlite.org/backup.html)
- Drive may purge old file revisions, so Forgecy creates independent immutable snapshot files. [Drive revision management](https://developers.google.com/workspace/drive/api/guides/manage-revisions)
- Next.js supports excluding Node-specific native packages from route bundling with `serverExternalPackages`. [Next.js configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)
