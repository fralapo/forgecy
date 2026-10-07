# 0012 · “Sign in with ChatGPT” as a way to connect the OpenAI provider

- Status: accepted
- Date: 2026-10-07

## Context

Jacopo asked for “Sign in with ChatGPT” (SIWC) in Settings > AI providers, so a person could use their own ChatGPT Plus/Pro usage for eligible requests instead of the agency's OpenAI API key. A prior thread (2026-10-06) researched this and found OpenAI's SIWC program gated to a waitlist of approved partners, with no self-serve client registration, and did not build it. Jacopo asked again, with his own research pointing at `developers.openai.com/siwc`. This thread re-verified that research against OpenAI's live documentation and discovery document (`auth.openai.com/.well-known/openid-configuration`) on 2026-10-07:

- Authorization: `https://auth.openai.com/api/accounts/authorize` · Token: `.../api/accounts/oauth/token` · Revoke: `.../api/accounts/oauth/revoke` · JWKS: `.../.well-known/jwks.json`.
- OAuth 2.1 + OpenID Connect, PKCE (S256) required, `authorization_code` and `refresh_token` grants, scopes `openid profile email offline_access` for identity.
- No dynamic client registration endpoint: a client id is issued by hand, only to approved partners (`developers.openai.com/siwc/request-client-id`: “currently offered to a select group of commercial partners”).
- ChatGPT **plan usage** (spending the person's Plus/Pro quota for API-eligible requests, the actual cost-saving reason for this request) is explicitly a **separate, unpublished** authorization and registration flow (SIWC's own docs: “ChatGPT plan usage in open-source apps has a separate authorization and registration flow”) — no scope string, consent screen, or Responses API contract is documented anywhere OpenAI publishes today.

## Decision

- Build the real identity OAuth flow now, correctly, against the endpoints above (PKCE, state, token exchange, refresh, best-effort revoke, ID token signature verified against OpenAI's JWKS), so it activates the moment Forgecy has a client id — nothing else needs to change.
- One connection per person (`siwc_connections`, unique on `user_id`), never pooled or shared, matching OpenAI's own Sign in with ChatGPT terms (per-user authorization, no token sharing across users). Tokens are encrypted at rest with `FORGECY_ENCRYPTION_KEY` (`packages/ai/src/crypto.ts`, the same scheme as `ai_connections` and `mcp_connections`) and read only server-side.
- The client id is not a secret: an Admin can set it from Settings > AI providers (`app_settings` key `ai.siwc_client_id`) or from `OPENAI_SIWC_CLIENT_ID` in `.env` (the interface value wins). `OPENAI_SIWC_CLIENT_SECRET` stays `.env`-only, for a confidential client; Forgecy defaults to a public client (PKCE, no secret), which fits a self-hosted app with no separate backend that could keep a secret.
- Without a client id configured (the default, realistic state until OpenAI approves one), the page shows “Awaiting OpenAI approval” and a field for the Admin to paste the id once granted, instead of a Connect button that would only fail.
- Plan sharing is **not implemented**, because OpenAI has not published how: no scope, no endpoint, no Responses API contract to call correctly. Building it would mean guessing a scope string and an API shape OpenAI could change or reject outright. `siwc_connections.plan_sharing` exists for when that flow is published, defaulting to `false`; until then, connecting only confirms the person's identity (name, email) and every AI request still goes through the agency's configured OpenAI API key, unchanged. The Settings page says this plainly rather than implying a cost saving that cannot happen yet.
- The AI gateway (`packages/ai/src/gateway.ts`) is unchanged: it builds provider clients once per process from `.env`/the agency's routing settings, not per request per user. Routing an individual request through a specific person's token is exactly the plan-sharing flow above and is deferred with it; `validSiwcAccessToken()` is written (token, refreshed on demand) so that wiring is a follow-up once OpenAI's plan-usage contract exists, not a rewrite.

## Consequences

- Today this feature is inert for everyone except an Admin who has requested and received a client id from OpenAI — exactly the state the prior thread found, now with working plumbing behind it instead of nothing. Jacopo can request a client id now; Settings will pick it up with no further deploy.
- If OpenAI later publishes the plan-usage scope/flow, the work left is: request that scope during `beginSiwcConnection`, read the grant from the token response into `plan_sharing`, and have `createProvidersFromEnv`'s OpenAI client branch (or a new per-request path in the gateway) call `validSiwcAccessToken()` for a client-policy-eligible request before falling back to the agency key.
