# 0007 · Image subscriptions over MCP (Higgsfield, Figma Weave)

- Status: accepted
- Date: 2026-10-06
- Note 2026-10-08: this number was used twice; refer to this ADR by its file name (see 0016).
- Update 2026-10-07: Figma Weave was removed (`weave` provider, its MCP adapter, settings/UI, env vars). Jacopo could not connect his Weave subscription — Figma's OAuth kept answering 403 to Forgecy as an unlisted MCP client (see Consequences below) — so the integration never worked for any install. Higgsfield is unaffected and stays as described below.

## Context

Some agencies already pay for an image subscription (Higgsfield, Figma Weave) and want Forgecy to spend those credits instead of an API key. Neither offers an API key for this: both expose their tools over a remote MCP server with OAuth.

Checked on 2026-10-06:

- **Higgsfield**: `https://mcp.higgsfield.ai/mcp`, OAuth with no API key, "works with any MCP-compatible agent"; every MCP generation spends credits at standard rates (unlimited plans apply only on higgsfield.ai); results also appear in the Higgsfield assets. Tool names and arguments are not documented by Higgsfield itself (third-party guides name `generate_image` with `model`, `prompt`, `aspect_ratio`).
- **Figma Weave**: no separate server; Weave tools come through Figma's remote MCP server `https://mcp.figma.com/mcp` (`weave_find_model`, `weave_run_model`, `weave_get_model_run_output`, plus tools for published Weave workflows). It needs a Weave plan (Starter or higher) with the Figma account linked in Weave. Runs spend Weave credits and are gated: a first `weave_run_model` call only quotes the cost; a second one with `acknowledgedCost` runs. Several users report that Figma's OAuth answers 403 to MCP clients it has not allowlisted.

## Decision

- `higgsfield` and `weave` are image providers (`ai_provider` enum) reached through `@modelcontextprotocol/sdk` (MIT): Streamable HTTP transport, OAuth 2.1 with PKCE and dynamic client registration. An Admin clicks **Connect** in Settings > AI providers, logs in on the provider's site and comes back to `/api/mcp/callback`. One agency-wide connection per provider in `mcp_connections`; client registration, tokens and the pending PKCE verifier are encrypted with `FORGECY_ENCRYPTION_KEY`.
- Adapters read the server's tool list and input schemas at run time (prompt, aspect-ratio options, model) and accept image URLs, inline images or a job id to poll, because neither provider publishes a stable contract.
- Weave: the person who asked Forgecy for the image is the approval of the spend; `WEAVE_MAX_CREDITS_PER_IMAGE` (default 20) caps it, and a dearer quote fails the job before anything is spent.
- They join `IMAGE_PROVIDERS` like any other image provider (route only while connected), need the same commercial-use verification, and are external providers for the AI policy (`local_only` never reaches them).

## Consequences

- Cost in `jobs_log` is 0 and flagged unpriced: credits are not dollars and the servers do not report a price. The subscription's own dashboard is the place to watch credits.
- Weave may not connect until Figma allowlists Forgecy as an MCP client; the error shows on the provider card. Higgsfield has no such restriction documented.
- Tool names and outputs may change on the providers' side; the adapters fail with a message naming the tools they found.
