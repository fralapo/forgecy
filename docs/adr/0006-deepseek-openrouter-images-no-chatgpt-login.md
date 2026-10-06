# 0006 · DeepSeek, OpenRouter images, no "Sign in with ChatGPT"

- Status: accepted
- Date: 2026-10-06

## Context

The agency asked for more ways to pay for AI: OpenAI and OpenRouter API keys (OpenRouter gives access to many text and image models, DeepSeek included), DeepSeek's own API, and logging in with a ChatGPT account so a subscription covers text review instead of API credits.

Checked on 2026-10-06:

- **Sign in with ChatGPT** (developers.openai.com/siwc) is offered "to a select group of commercial partners" through an interest form. It needs a client ID issued by OpenAI with registered redirect URIs, and identity scopes alone give no access to OpenAI APIs. Even where plan usage is allowed, it covers eligible Responses API requests, not image generation.
- **DeepSeek** has an OpenAI-compatible API at `https://api.deepseek.com` (models `deepseek-flash`, `deepseek-v4-pro`). Its JSON output documents only `response_format: {type: "json_object"}`, with the word "json" and an example of the format in the prompt.
- **OpenRouter** generates images through Chat Completions with `modalities: ["image", "text"]` and `image_config.aspect_ratio`; images come back as data URLs in `message.images`, and `usage.cost` reports the billed amount.

## Decision

- No ChatGPT login. A self-hosted install cannot get its own client ID, so it would only work if OpenAI admitted Forgecy as a partner and every agency's address were registered. Revisit if OpenAI opens the program.
- DeepSeek is a text provider (`deepseek`, key `DEEPSEEK_API_KEY`, `AI_DEFAULT_PROVIDER=deepseek` possible). The adapter is the OpenAI-compatible one in `json_object` mode: the JSON Schema goes into the system prompt and Zod validates the answer, with the gateway's usual second attempt on failure. Cache hits (`prompt_cache_hit_tokens`) are priced as cache reads.
- OpenRouter is also an image provider with the same `OPENROUTER_API_KEY`; the model is `OPENROUTER_IMAGE_MODEL`. Its reported cost goes into `jobs_log`.
- The order of image providers is `IMAGE_PROVIDERS` (default `openai,google,openrouter`): the first configured one is primary, the next the fallback. Each one still needs the Admin's commercial-use verification in Settings > AI providers before it generates for real clients.

## Consequences

One migration adds `deepseek` to the `ai_provider` enum. DeepSeek and OpenRouter are external providers: `local_only` clients never reach them, `external_restricted` clients only if approved. DeepSeek prices in `pricing.ts` are the peak-hour list prices and must be re-checked; OpenRouter needs no price rows.
