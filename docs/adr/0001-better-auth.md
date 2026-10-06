# 0001 · Better Auth instead of Auth.js

- Status: accepted (M1)
- Date: 2026-10-05

## Context

The specification calls for Auth.js for local password, magic link and Google OAuth. Since September 2025 Auth.js has been in maintenance mode (security patches only): it is maintained by the Better Auth team, which recommends Better Auth for new projects.

## Decision

We use Better Auth (MIT, self-hosted, sessions in our PostgreSQL) with the Drizzle adapter. It covers the specification's three access levels:

- `local` and `intranet`: email and password; public sign-up is off, accounts are created by the first start (`/setup`) or by an Admin.
- `team`: additionally magic link (token stored only as a hash, expiry `FORGECY_MAGIC_LINK_TTL_MINUTES`, default 15) and Google OAuth, only for the domains in `FORGECY_ALLOWED_EMAIL_DOMAINS`.

Better Auth telemetry off, rate limiting on sign-ins, deactivated users blocked at session creation.

## Consequences

The identity tables are `users`, `sessions`, `accounts`, `verifications` (`packages/db/src/schema/auth.ts`). The password lives in `accounts.password` and not in `users.password_hash` as in the specification. Permissions stay in code (`can()` in `packages/core`), independent of the sign-in library.
