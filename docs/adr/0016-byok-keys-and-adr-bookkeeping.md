# 0016 · API keys saved in Settings (BYOK), and ADR bookkeeping

- Status: accepted
- Date: 2026-10-08

## Context

Three things drifted from the ADRs as written:

1. 0008 says provider keys "stay in `.env`". Since #73 an Admin can paste an OpenAI, Anthropic, OpenRouter or DeepSeek key in Settings > AI providers. No ADR recorded it; ADR 0013 and `docs/ARCHITECTURE.md` already assume it.
2. 0006 says "No ChatGPT login"; 0012 (later) builds the identity OAuth plumbing for it, inert until OpenAI issues a client id. 0006 also states `IMAGE_PROVIDERS` defaults to `openai,google,openrouter`; the code (`imageProviderIds` in `packages/ai/src/registry.ts`) defaults to `openrouter,openai,google,higgsfield`.
3. Two ADRs carry the number 0007 (agent playbooks; image subscriptions over MCP), and 0008 still names Weave, which was removed.

## Decision

- Keys pasted in Settings are agency-wide, Admin-only (`ai.providers.manage`), stored encrypted with `FORGECY_ENCRYPTION_KEY` in `ai_connections`, shown only as a hint, and take precedence over the provider's environment variable (`resolveAiEnv`). Without `FORGECY_ENCRYPTION_KEY` the feature is unavailable and `.env` keys keep working. Backups never include `.env`, so restoring a backup on a machine without the same encryption key leaves saved keys unreadable. This supersedes only the "keys stay in `.env`" sentence of 0008; the rest of 0008 stands.
- 0012 stands. Of 0006, only the "no ChatGPT login" decision is superseded. The default image order is whatever `imageProviderIds` says; documents must not restate it.
- The duplicate 0007 is kept (links already use the file names, accepted ADRs are not rewritten). Refer to them as `0007-agent-playbooks` and `0007-image-subscriptions-over-mcp`. New ADRs take the next unused number, enforced by `scripts/test/adr.test.ts`.
- ADR 0014 and 0015 (this branch's sign-in and client-import work) took their numbers before this one; the numbering has no gaps.

## Consequences

Status lines of 0006 and 0008 point here; their bodies are untouched. The ADR test fails on a new duplicate number, a gap, a missing status, or a "superseded by" pointing at nothing.

The hardening work left decisions for the owner; they are listed, with how to check each, in section 7 of `docs/SECURITY_CHECKLIST.md` ("Follow-ups left open"): a least-privilege restore role, a `pg_dump -Fc` / `pg_restore` restore route, per-client access control (ADR 0014), the template zip importer, the client-package export caps and the other import limits, the untested Docker choices, and the scanner drill on Postgres majors other than 17 (it passed on a real `pg_dump` 17).
