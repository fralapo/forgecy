# 0013 · OpenRouter defaults and model search from its live catalog

- Status: accepted
- Date: 2026-10-07

## Context

Jacopo: the Settings > AI providers model fields are plain text with no guidance ("non si capisce nulla, soprattutto selezione dei modelli"), and asked for OpenRouter to default to the newest DeepSeek Flash model for text and the newest GPT image-generation model for images. OpenRouter's catalog changes over time (new model versions, retired ones), and this thread had no reliable way to browse OpenRouter's site (JavaScript-rendered, and this sandbox's egress policy blocks a direct fetch of `openrouter.ai`) to confirm a specific model id by hand. Hardcoding a guessed id would risk exactly the kind of stale/wrong default this request is about.

## Decision

- `packages/ai/src/providers/model-catalog.ts` fetches a BYOK provider's live model list — OpenAI, Anthropic and DeepSeek each need the agency's own key (resolved the same way everywhere else: pasted key first, else the env var); OpenRouter's is public — and normalizes each provider's own response shape (OpenAI/OpenRouter/DeepSeek report `created` as unix seconds; Anthropic reports `created_at` as an ISO 8601 string) into `{id, name, created}`, cached in memory 10 minutes per provider. The same four endpoints were already in use (and proven reachable) by the existing "Test" button on each API key card (`connections.ts`'s `testApiKey`), which now shares this module's endpoint/header constants instead of duplicating them.
- `openrouter-catalog.ts` keeps OpenRouter's own "latest DeepSeek Flash" / "latest GPT image model" picking logic on top of this shared fetch: the newest (`created` desc) canonical (non-alias, non-`:batch`) model matching `deepseek/*flash*` for text and `openai/*gpt-image*|*dall-e*` for images.
- `resolveRouting`/`createRoutingSource` (routing-settings.ts) use this live pick when the Admin leaves an OpenRouter model field empty, ahead of the hardcoded fallback constants (`OPENROUTER_DEFAULT_MODEL`, `OPENROUTER_IMAGE_DEFAULT_MODEL` in `openai-compatible.ts`/`openrouter-images.ts`), which now hold the last-known-good id and are used only if the live fetch fails (no internet, OpenRouter down). The other three providers keep their existing fixed defaults (not asked for here) but gain the same searchable field.
- Settings > AI providers shows OpenRouter's live-resolved value as its field's placeholder, so what the Admin sees matches what jobs actually use.
- An Admin-only route (`/api/ai/models?provider=…`) serves each provider's catalog to a searchable field (`live-model-field.tsx`, a native `<input list>`/`<datalist>`) that replaces the blind text box for every provider with a model list — all four for text, OpenAI and OpenRouter for images (Google and Higgsfield have no such endpoint to call); any model id can still be typed or pasted, the list is a suggestion.
- Text and image services were already chosen independently (separate provider selects, and the image list is already an ordered, mixed-provider list with per-provider models) — mixing providers or keys across text and images, or using OpenAI for both, needed no new code, only the clearer UI above.

## Consequences

Settings now makes one outbound call per configured BYOK provider (cached 10 minutes) when its field is shown; a network failure (or no key yet) degrades to the hardcoded fallback / a plain unsuggested text field rather than breaking anything. The "latest" pick (OpenRouter only) is a heuristic (substring match on the id, newest `created` wins) rather than a provider-documented "latest" alias, since this wasn't independently verifiable from this thread (see the original context above); if it proves wrong in practice, the Admin can still always pin an exact model id by hand.
