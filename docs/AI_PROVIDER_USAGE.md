# Forgecy V25 — provider usage telemetry (OpenRouter / OpenAI images)

This change adds **measured, provider-reported usage observations** per client. It does **not** implement a hard USD/EUR budget, a billing system, or a guarantee that every charge was captured. V24's atomic request-count limits remain active and independent.

## Activation

1. Apply `supabase/migrations/0017_ai_provider_usage.sql` after 0016 in staging, then production following the existing backup/migration procedure.
2. Configure `SUPABASE_SERVICE_ROLE_KEY` **on the server only** for both synchronous API routes and the worker. If absent, AI generation still works under existing V24 limits, but telemetry cannot be saved. The server logs a warning, not customer data.
3. Ensure `OPENROUTER_API_KEY` is set and the chosen model supports regular completion usage. Forgecy asks for `usage:{include:true}`; cost is read only from the OpenRouter response's `usage.cost` field, not derived from a price list.
4. If OpenAI image generation is configured, `/v1/images/generations` may provide input/output tokens; costs are **NULL** because that endpoint does not supply the final USD charge.
5. Deploy the application code with migration 0017 in place. The new **Risultati → Utilizzo dei modelli AI** panel displays totals for 7/30/90 days. It requests `GET /api/workspace/clients/:id/ai-usage?days=30` and does not display sensitive provider request identifiers.

## Data model and privacy

`public.ai_provider_usage` contains:
- `client_id`, `requested_by`, optional queued `job_id`, operation and provider;
- model actually reported by OpenRouter when present;
- reported input/output/total token counts and **nullable reported cost USD**;
- status `reported` or `unavailable`, timestamp and optional OpenRouter generation ID for replay deduplication.

No prompts, generated images, customer text, tokens, provider keys or other secret material are persisted in this ledger. Supabase RLS lets an authenticated owner **read only their own client's records**. Inserts require the server-only service role; ordinary users cannot insert, edit or delete entries. A SECURITY INVOKER aggregate function returns at most 100 model/operation groups with the number of calls that actually reported a cost.

## Accounting behavior

- Normal chat and content adaptation are scoped to the authenticated client.
- Dossier and campaign generation from the synchronous endpoints are scoped likewise.
- The queued worker scopes all stages (including multiple specialist calls) to `job_id`, `client_id` and `requested_by`.
- Image generation records provider tokens if the response includes them, with `reported_cost_usd=NULL`.
- The recorder runs **after** the paid provider call. A database outage must not cause the app to retry a billable generation. Ledger failures are logged without blocking the AI response.
- Missing costs are shown as unknown, not as $0. A total can be displayed as a *partial reported subtotal*, including cases where the model returned an output without usage data.
- A unique `(provider,provider_request_id)` index prevents duplicate reporting of identical provider response IDs where available. OpenAI image API responses do not provide the same stable ID, so exactly-once accounting is not guaranteed there.
- Historical calls made before V25 are not reconstructed.

## Security and limitations

Usage can be missing when the model times out, the server crashes between response and insert, the provider omits usage, or a service-role key is not available. Invoices may include additional fees or provider-specific pricing that do not appear in an individual response. A reported cost from OpenRouter may not include all external payment fees. **Never use this dashboard as an accounting or invoice reconciliation authority.**

Before enforcing spend caps, Forgecy would need **preauthorization of maximum provider spend** (not just request counts), per-model maximum output settings, atomic reservations and reconciliation against authoritative provider generation/usage APIs, handling missing-cost states, webhook or periodic billing cross-check, alerts and an explicit stop policy. A model can still incur cost when a response is lost, so a hard cap must be provided by the upstream provider or account billing settings.

## Test plan

GitHub Actions runs TypeScript, lint, unit tests, PostgreSQL 16 migrations 0001–0017 and RLS smoke tests, and production build. Unit tests verify zero vs missing cost, parallel tenant isolation with AsyncLocalStorage, and no billing retry on a failed insert. SQL tests verify immutable events, cross-owner isolation, anonymous denial and aggregate accuracy. A real-provider acceptance test is still required before trusting metrics operationally.

References:
- https://openrouter.ai/support/ (request usage with `usage:{include:true}`)
- https://github.com/OpenRouterTeam/docs/blob/main/api_reference/overview.mdx (response `usage.cost` and generation ID)
- https://developers.openai.com/api/reference/resources/images/methods/generate (image token usage)
