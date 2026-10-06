# @forgecy/ai

Forgecy's AI gateway. **No part of Forgecy calls a provider directly**: everything goes through `createAiGateway()`.

```ts
const providers = createProvidersFromEnv(env);
const ai = createAiGateway({
  ledger: createDbLedger(db),
  providers,
  routing: defaultRoutingFromEnv(env, providers),
  logger,
});
const { data } = await ai.generateObject({
  task: "outline",
  schema,
  system,
  input,
  clientId,
  clientPolicy,
  authorizedBy,
});
```

## Rules

- **Policy first**: `checkAiPolicy` (from `@forgecy/core`) is applied before every request. `no_ai` blocks; `local_only` uses only `routing.local` and, if it is missing, stops with a clear error (never a cloud fallback); `external_restricted` uses only the approved providers.
- **Budget**: before every job the month's spend is summed from `jobs_log` per agency and client. Warning at `warn_at_percent`, block at 100% with `ForgecyError("budget_exceeded")`.
- **Structured output**: the Zod schema becomes JSON Schema (`z.toJSONSchema`), the provider receives it in its own format (Anthropic `output_config.format`, OpenAI-compatible `response_format: json_schema`), and the response always goes through Zod. If it fails, a second attempt receives the validation error; after 2 errors the job fails.
- **Errors**: retryable (429, 5xx, network, timeout) and refusals → the task's fallback, if the policy allows it. Non-retryable (400, auth) → error immediately. `max_tokens` → explicit error. The SDKs already retry 429/5xx internally (`maxRetries`).
- **Log**: every attempt, even a blocked one, writes a row in `jobs_log`: provider, model, policy, who authorized it, tokens, cost in micro-USD and `input_summary` with **field names, sizes and SHA-256 hashes, never the content**. For extra data use `inputSummary.fields` (they get hashed) or `meta` (non-sensitive values only).
- **Input images (vision)**: `generateObject({ ..., images: [{ data, mimeType, id? }] })` sends the images (PNG, JPEG, WebP, GIF; at most 20, 3.75 MB each) in the first message, before the text. The same policies, budget and log apply: only `id`, SHA-256, bytes and type end up in `input_summary.images`. With `local_only` you need a local model with vision (e.g. `qwen2.5vl` or `llama3.2-vision` on Ollama).
- **Prices**: `src/pricing.ts` is an editable table. It must be checked against the providers' pages; missing models cost 0 and are flagged (`unpriced: true`).
- **BYOK keys**: `encryptSecret` / `decryptSecret` (AES-256-GCM with `FORGECY_ENCRYPTION_KEY`); only `keyHint` (last 4 characters) in plain text. Never in logs.

## Providers

| Provider     | Text | Images | Key / setting                                                         |
| ------------ | ---- | ------ | --------------------------------------------------------------------- |
| `anthropic`  | yes  | no     | `ANTHROPIC_API_KEY`                                                   |
| `openai`     | yes  | yes    | `OPENAI_API_KEY`                                                      |
| `openrouter` | yes  | yes    | `OPENROUTER_API_KEY`, image model `OPENROUTER_IMAGE_MODEL`            |
| `deepseek`   | yes  | no     | `DEEPSEEK_API_KEY` (JSON via `json_object`, schema in prompt)         |
| `google`     | no   | yes    | `GOOGLE_AI_API_KEY`                                                   |
| `local`      | yes  | no     | `LOCAL_LLM_ENABLED`, `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`          |
| `higgsfield` | no   | yes    | MCP + OAuth (Connect in Settings), `HIGGSFIELD_IMAGE_MODEL`           |
| `weave`      | no   | yes    | Figma MCP + OAuth, `WEAVE_IMAGE_MODEL`, `WEAVE_MAX_CREDITS_PER_IMAGE` |

Image providers are tried in the order of `IMAGE_PROVIDERS` (default `openai,google,openrouter`): first configured one primary, next one fallback. Logging in with a ChatGPT account is not supported (see `docs/adr/0006`).

### Subscriptions over MCP

`src/mcp/` connects to remote MCP servers as an OAuth client (`@modelcontextprotocol/sdk`): `StoredMcpOAuthProvider` keeps the registration and tokens encrypted in `mcp_connections`, `beginMcpConnection` / `completeMcpConnection` drive the Admin's login, and `createMcpImageProviders` builds the Higgsfield and Weave adapters. The adapters read tool schemas at run time and poll async jobs through the gateway's usual `getStatus` loop. `imageRouteWithMcp` adds the connected ones to the image route. See `docs/adr/0007`.

## Adding a provider

1. If it is compatible with the OpenAI API, `createOpenAICompatibleProvider({ id, apiKey, baseURL })` is enough. Otherwise create `src/providers/<name>.ts` implementing `TextProvider` (or `ImageProvider` for images): it translates `jsonSchema` into the provider's format, normalizes `stopReason` and `usage`, and converts errors with `classifyError()` or `AiProviderError`.
2. If a new `ProviderId` is needed, add it in `@forgecy/core` (`providerIds`) and in the migration of the `ai_provider` enum.
3. Register it in `createProvidersFromEnv` only when its configuration exists.
4. Add the prices in `pricing.ts`.
5. Test with a fake `fetch` (see `test/adapters.test.ts`): no network in tests.
6. Before enabling it as primary or fallback for a task, check the prompts on the fixed set of 10 test briefs.

## To verify

- `providers/google-images.ts`: `generateContent` endpoint, model IDs and response shape (Google also documents `/v1beta/interactions`).
- Prices of Google images, OpenRouter models and local models.
