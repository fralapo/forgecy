# 0026 · Open auth mode (single admin, no sign-in)

- Status: accepted
- Date: 2026-10-12

## Context

On a machine only one person uses, the sign-in page and the user list add friction and no protection. Every page, action and permission check already gets its person from one place, `getCurrentUser` (`apps/web/lib/session.ts`), so a mode without sign-in can reuse the whole permission model instead of bypassing it.

## Decision

- `FORGECY_AUTH_MODE=open` (a fourth value beside `local`, `intranet`, `team`; `packages/core/src/env.ts`). The default stays `local`.
- In `open` mode `getCurrentUser` returns the oldest active Admin from the database and never reads a session cookie. Everything downstream (`can()`, client scope, activity log, agents acting for a person) works unchanged, as that Admin.
- The proxy (`apps/web/proxy.ts`) skips the session-cookie redirect in `open` mode; the login page already redirects to `/` when there is a current user.
- No other people: the "new user" form is hidden in Settings and `createUserAction` throws. Existing rows are kept; there is still a first-run `/setup` that creates the one Admin when the database has none.
- Password sign-in is not removed: it still works if someone posts to it, but nothing needs it.

## Consequences

- Anyone who can reach the web port acts as the Admin. The compose file binds the port to `127.0.0.1`; do not publish it, and do not use `open` behind a reverse proxy or on a shared host.
- Switching back to `local` needs the Admin's password. If it is lost, set a new hash in `accounts.password` (Better Auth `hashPassword`) and delete the `forgecy:login:*` Redis keys.
- No schema change and no migration.
