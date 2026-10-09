# 0020 · Per-client access

- Status: accepted
- Date: 2026-10-09
- Replaces: the "Single-tenant trust boundary" bullet of 0014

## Context

Until now every active person could read and change every client by id (`docs/adr/0014-auth-hardening.md`, "Single-tenant trust boundary"): `can()` checked the role and the action, never the client. Agencies that work with freelancers, or keep some accounts away from some clients, need a person to see only the clients assigned to them. The services already pass the client to `assertCan(actor, permission, clientId)` almost everywhere (about 190 calls), and read rows by the pair (client, id), so the missing piece was the assignment itself, a filter for lists and the cross-client screens.

## Decision

- **Table `client_access`** (`packages/db/src/schema/client-access.ts`, migration `0032_client_access`): `user_id`, `client_id`, `created_at`, `created_by`; primary key (`user_id`, `client_id`), foreign keys `ON DELETE CASCADE` (`created_by` `SET NULL`), index on `client_id`.
- **Rule.** An Admin (`isAdmin`) sees and acts on every client. Anyone else sees and acts only on the clients assigned to them. Someone with no assignment sees no client. Agents are unchanged: they act only inside a job a person started, and that person's access was checked where the job was started.
- **One enforcement point, still pure.** The user actor carries its scope: `Actor` gains `clients: "all" | string[]` (`packages/core/src/permissions.ts`). `canAccessClient(actor, clientId)` is the rule; `can(actor, permission, clientId)` now also requires it whenever a `clientId` is given, so every existing `assertCan(..., clientId)` call enforces assignment without changing. A `clientId` still only narrows the answer. `can()` stays synchronous: the scope is read once when the actor is built, by `clientScopeOf`/`loadClientScope` (`packages/db/src/client-access.ts`), in `getCurrentUser` (once per request) and by `userActor` in the worker. The field is required in the type, so the compiler finds every place that builds a user actor.
- **Lists.** `clientScopeWhere(actor, column)` (`@forgecy/db`) is the SQL filter for anything that lists rows of several clients; undefined for Admins and agents, `false` for nobody.
- **Not found, not forbidden, in pages.** A `[clientSlug]` or `[slug]` page whose client is not assigned answers 404 like a missing client. Services keep answering `permission_denied` for a client the actor cannot open; reading another client's row with one's own client id is "not found", since rows are read by the pair.
- **New clients.** Creating a client (Clients screen) or a prospect (Audit) assigns it to its creator in the same transaction (`grantClientAccess`); for the rest of that request the action uses `actorWithClient`.
- **Admin screen.** Settings → Client access (`/settings/client-access`, `users.manage`): pick a person, tick their clients; each change writes `client_access.grant` or `client_access.revoke` to the activity log (`setClientAccess`). The client page lists who has access (`clientMembers`), Admins included.
- **The upgrade backfill.** Migration 0032 inserts one row for every (non-Admin person, client) pair that exists when it runs, deactivated accounts included, so access after the upgrade is exactly access before. Admins get no rows (they need none). A backup taken before the upgrade gets the same backfill when its migrations run after the restore.
- **Where it is applied.** Each entry point, with the call that enforces it:
  - Services that already take `(actor, clientId)` or load the row and check its `client_id` (content, brand, brand book, Brand Guard, catalog, audit mutations, automations, agent memory): through `can()`. Gaps closed here: `findOrCreateWebsiteSource` returned an existing source before any check; memory decisions revealed who decided a memory before checking its client; template status changes checked only `templates.manage`.
  - Cross-client lists: Clients, Brand, Content, Products pickers, Search (and its client filter; a client's private templates only with access, ADR 0021), Audit prospects list and duplicate warning (`listProspects`, `findDuplicates` take the actor), Automations (filtered in SQL), agent memory (`listMemories`, `memoryCounts`, `getMemory`), agent runs (`listAgentRuns`, `getAgentRun`: agency runs stay visible), the Templates catalog, template page and layout previews.
  - Slug loaders in `apps/web`: `loadClientPage`, `loadBrand`, `loadClient` (content), `catalogPage` (products), `getProspectBySlug` (audit layout, overview and section pages); the products route handlers (CSV export, import file, rejected rows, product images) check before reading.
  - Jobs: `canViewJob` already passes the job's client to `can()`, so `/api/jobs/:id/events` (SSE) and every `jobVisibleTo` caller hide another client's jobs. Worker jobs started by a person (report export, Brand Book render, automation items) run with that person's scope read at run time, so a person unassigned since the start makes them fail instead of reaching the client.
  - Notifications: `notify` sends nothing about a client to someone who cannot open it; the bell list and counter hide earlier ones once the person loses access.
  - Client export (Admin only): the export and its estimate also check the client. `client_access` never travels in a client package (`EXCLUDED_TABLES`).

## Consequences

- An upgrade changes nobody's access. From then on a new person sees no client until an Admin assigns some, and a new client is visible to its creator and the Admins only. Admins can restrict people by removing assignments.
- Demoting an Admin leaves them with no client until assigned (the backfill gave Admins no rows).
- A change of assignment takes effect on the person's next request; a page already open keeps what it rendered.
- Two people can create clients with the same name without seeing each other's: the duplicate warning only lists clients the person can open.

## Not covered

- Signed file URLs (`/api/files/...`) are authorized by their signature, not by the session: a URL issued while the person had access keeps working until it expires (15 minutes at most for pages, 24 hours for a client export, which is Admin only).
- Agency-wide figures stay visible to everyone: agent statistics and acceptance rates, and runs without a client.
- Activity log entries are read per client through the client page (gated); there is no cross-client activity screen to filter.
- The setting screens that are Admin-only (AI policies with their per-client budgets, import/export, backups) are not filtered: Admins see every client.
- Template validation (`revalidateAction`) re-queues the check of any template by id for people with `templates.manage`; it shows no content.
- `apps/web` pages that read a client's rows directly after the slug loader (overview, activity, library) rely on that loader; there is no row-level security in Postgres.
