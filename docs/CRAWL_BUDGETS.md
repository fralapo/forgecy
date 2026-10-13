# Website crawl budgets — security release V19

Forgecy's site ingestion is a **privileged, opt-in network operation**. Its per-request page cap does not prevent multiple users or server instances from exhausting shared resources. Migration `0012_website_crawl_budgets.sql` adds a database-backed, atomic reservation **before any DNS or HTTP activity**.

## Limits (rolling windows)

| Scope | Rule | Result |
| --- | --- | --- |
| One client | At most 2 reservations per 15 minutes | SQLSTATE `P0429` → HTTP 429 |
| One client | At most 24 reserved pages per 24 hours | HTTP 429 |
| One account, across all its clients | At most 30 reservations per 24 hours | HTTP 429 |
| One account, across all its clients | At most 144 reserved pages per 24 hours | HTTP 429 |
| One crawl | At most 6 HTML pages, bounded robots/sitemap requests | Existing crawler limits |

A request for `maxPages: 6` reserves **six pages**, even if fewer are actually acquired. Failed site fetches consume the reservation intentionally to prevent inexpensive abuse by repeatedly submitting unreachable targets. The quota uses a *rolling* clock; it does not reset at midnight.

## Security contract

1. Browser calls an authenticated Next.js endpoint with the current client's UUID.
2. Existing `requireClient` enforces user ownership, then the route checks that `ENABLE_WEBSITE_INGEST=true`. Invalid public HTTPS URLs are rejected without consuming quota.
3. The route calls the `forgecy_reserve_website_crawl` Supabase RPC and only continues when a reservation UUID is returned.
4. The `SECURITY DEFINER` function independently checks `auth.uid() == clients.owner_id`. It takes a transaction-scoped advisory lock **per owner** before querying or inserting, so overlapping requests on separate server processes cannot bypass the limit.
5. Direct authenticated table reads and writes are denied. No full URL, path, token, response body or other client documents appear in `website_crawl_requests`—only owner/client, hostname, reserved pages and timestamp.
6. Any missing migration, unavailable Postgres, unexpected error or malformed reservation response **fails closed** with HTTP 503. Only a confirmed `P0429` is returned as HTTP 429.

**Not a replacement for an outbound network firewall.** The crawler must remain disabled until a network-level deny policy blocks private, loopback, link-local, metadata and internal destinations. Also keep request latency, bandwidth and domain-specific polite crawling limits appropriate to the hosting environment.

## Deployment and rollback

1. For the current app, apply migrations **0001 through 0017** in your Supabase project (0012 introduces crawl quotas). A separate disposable test project is optional.
2. Confirm the authenticated quota RPC and the SQL RLS smoke tests with two users and separate clients.
3. Deploy the app; the crawler stays **off** by default. No frontend credential or service-role key is needed for reservations.
4. Configure egress filtering, then enable `ENABLE_WEBSITE_INGEST=true` only in a verified environment.
5. Test overlapping reservations from two independent server instances, then a real permitted website crawl.
6. Monitor HTTP 429/503 rates and audit the client `website_crawl_finished` records.

**Rollback:** turn off `ENABLE_WEBSITE_INGEST`, roll back the application and leave the additive database migration intact. Do not drop quota history as an emergency recovery step. Existing reservations age out after their rolling windows. A privileged maintenance job may delete records older than a retention policy (for example, 90 days) without affecting the 24-hour budget.

## Validation

- `tests/sql/smoke.sql`: client isolation, direct-insert denial, 15-minute burst cap, 24-hour client budget, 24-hour owner aggregate and independent owners.
- `tests/unit/crawl-budget.test.ts`: disabled-mode refusal, exact RPC contract, 429 handling and fail-closed DB errors.
- GitHub Actions: TypeScript, Node tests, PostgreSQL migrations/RLS and production build.

## Known limitations

- Reservation limits constrain *completed authorization attempts*, not total bytes transferred by a malicious or compromised remote site. The crawler's existing byte/time caps still apply.
- This is not a global IP-based rate limiter for every Forgecy API endpoint. Other expensive operations require their own budgets.
- No cross-deployment load-test or real-network SSRF penetration test is possible without a configured isolated test environment. CI proves SQL behavior and API utility logic, not infrastructure egress protection.
