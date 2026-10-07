# 0013 · OpenRouter defaults and model search from its live catalog

- Status: accepted
- Date: 2026-10-07

## Context

Jacopo: the Settings > AI providers model fields are plain text with no guidance ("non si capisce nulla, soprattutto selezione dei modelli"), and asked for OpenRouter to default to the newest DeepSeek Flash model for text and the newest GPT image-generation model for images. OpenRouter's catalog changes over time (new model versions, retired ones), and this thread had no reliable way to browse OpenRouter's site (JavaScript-rendered, and this sandbox's egress policy blocks a direct fetch of `openrouter.ai`) to confirm a specific model id by hand. Hardcoding a guessed id would risk exactly the kind of stale/wrong default this request is about.

## Decision

- `packages/ai/src/providers/openrouter-catalog.ts` fetches OpenRouter's public `GET /api/v1/models` (no key required, cached in memory 10 minutes) and picks the newest (`created` desc) canonical (non-alias, non-`:batch`) model matching `deepseek/*flash*` for text and `openai/*gpt-image*|*dall-e*` for images.
- `resolveRouting`/`createRoutingSource` (routing-settings.ts) use this live pick when the Admin leaves an OpenRouter model field empty, ahead of the hardcoded fallback constants (`OPENROUTER_DEFAULT_MODEL`, `OPENROUTER_IMAGE_DEFAULT_MODEL` in `openai-compatible.ts`/`openrouter-images.ts`), which now hold the last-known-good id and are used only if the live fetch fails (no internet, OpenRouter down).
- Settings > AI providers shows this same live-resolved value as the field's placeholder, so what the Admin sees matches what jobs actually use.
- A new Admin-only route (`/api/ai/openrouter-models`) serves the same catalog to a searchable field (`openrouter-model-field.tsx`, a native `<input list>`/`<datalist>`) that replaces the blind text box for OpenRouter fields specifically; any model id can still be typed or pasted, the list is a suggestion.

## Consequences

Settings now makes one outbound call to OpenRouter (cached 10 minutes) when OpenRouter is configured for text or images; a network failure degrades to the hardcoded fallback rather than breaking routing. The "latest" pick is a heuristic (substring match on the id, newest `created` wins) rather than an OpenRouter-documented "latest" alias, since the catalog's exact schema for such aliases wasn't independently verifiable from this thread; if it proves wrong in practice, the Admin can still always pin an exact model id by hand.
