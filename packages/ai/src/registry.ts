import type { Env, ProviderId } from "@forgecy/core";
import type { Routing } from "./gateway";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./providers/anthropic";
import { createGoogleImageProvider, GOOGLE_IMAGE_DEFAULT_MODEL } from "./providers/google-images";
import {
  createOpenAICompatibleProvider,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  LOCAL_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
} from "./providers/openai-compatible";
import { createOpenAIImageProvider, OPENAI_IMAGE_DEFAULT_MODEL } from "./providers/openai-images";
import {
  createOpenRouterImageProvider,
  OPENROUTER_IMAGE_DEFAULT_MODEL,
} from "./providers/openrouter-images";
import type { ModelRef, ProviderSet } from "./types";

export type AiEnv = Pick<
  Env,
  | "AI_DEFAULT_PROVIDER"
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "OPENROUTER_API_KEY"
  | "GOOGLE_AI_API_KEY"
  | "DEEPSEEK_API_KEY"
  | "OPENROUTER_IMAGE_MODEL"
  | "IMAGE_PROVIDERS"
  | "LOCAL_LLM_ENABLED"
  | "LOCAL_LLM_BASE_URL"
  | "LOCAL_LLM_MODEL"
> &
  Partial<Pick<Env, "FORGECY_BASE_URL">>;

/** Build only the providers whose keys/config exist. Local only when LOCAL_LLM_ENABLED. */
export function createProvidersFromEnv(env: AiEnv): ProviderSet {
  const set: ProviderSet = { text: {}, image: {} };
  if (env.ANTHROPIC_API_KEY)
    set.text.anthropic = createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
  if (env.OPENAI_API_KEY) {
    set.text.openai = createOpenAICompatibleProvider({ id: "openai", apiKey: env.OPENAI_API_KEY });
    set.image.openai = createOpenAIImageProvider({ apiKey: env.OPENAI_API_KEY });
  }
  if (env.OPENROUTER_API_KEY) {
    // Optional attribution headers documented by OpenRouter.
    const defaultHeaders = {
      "HTTP-Referer": env.FORGECY_BASE_URL ?? "http://localhost:3000",
      "X-Title": "Forgecy",
    };
    set.text.openrouter = createOpenAICompatibleProvider({
      id: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders,
    });
    set.image.openrouter = createOpenRouterImageProvider({
      apiKey: env.OPENROUTER_API_KEY,
      defaultHeaders,
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    set.text.deepseek = createOpenAICompatibleProvider({
      id: "deepseek",
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: DEEPSEEK_BASE_URL,
      // DeepSeek documents only `json_object`; the schema goes into the prompt.
      jsonMode: "json_object",
    });
  }
  if (env.GOOGLE_AI_API_KEY)
    set.image.google = createGoogleImageProvider({ apiKey: env.GOOGLE_AI_API_KEY });
  if (env.LOCAL_LLM_ENABLED) {
    set.text.local = createOpenAICompatibleProvider({
      id: "local",
      // Ollama and LM Studio ignore the key, but the SDK requires a value.
      apiKey: "local",
      baseURL: env.LOCAL_LLM_BASE_URL,
      // Local servers are slow to cold-start a model; let the gateway own retries.
      maxRetries: 0,
    });
  }
  return set;
}

export function defaultModelFor(provider: ProviderId, env: Pick<AiEnv, "LOCAL_LLM_MODEL">): string {
  switch (provider) {
    case "anthropic":
      return ANTHROPIC_DEFAULT_MODEL;
    case "openai":
      return OPENAI_DEFAULT_MODEL;
    case "openrouter":
      return OPENROUTER_DEFAULT_MODEL;
    case "deepseek":
      return DEEPSEEK_DEFAULT_MODEL;
    case "local":
      return env.LOCAL_LLM_MODEL ?? LOCAL_DEFAULT_MODEL;
    case "google":
      return GOOGLE_IMAGE_DEFAULT_MODEL;
    case "higgsfield":
    case "weave":
      return "";
  }
}

/** Providers that can generate images, in the default order of preference. */
export const imageProviderIds = [
  "openai",
  "google",
  "openrouter",
  "higgsfield",
  "weave",
] as const satisfies readonly ProviderId[];
export type ImageProviderId = (typeof imageProviderIds)[number];

export function imageModelFor(
  provider: ImageProviderId,
  env: Pick<AiEnv, "OPENROUTER_IMAGE_MODEL"> &
    Partial<Pick<Env, "HIGGSFIELD_IMAGE_MODEL" | "WEAVE_IMAGE_MODEL">>,
): string {
  switch (provider) {
    case "openai":
      return OPENAI_IMAGE_DEFAULT_MODEL;
    case "google":
      return GOOGLE_IMAGE_DEFAULT_MODEL;
    case "openrouter":
      return env.OPENROUTER_IMAGE_MODEL || OPENROUTER_IMAGE_DEFAULT_MODEL;
    // Empty: Higgsfield's own default model.
    case "higgsfield":
      return env.HIGGSFIELD_IMAGE_MODEL ?? "";
    case "weave":
      return env.WEAVE_IMAGE_MODEL ?? "nano banana 2";
  }
}

/** IMAGE_PROVIDERS parsed: known ids only, no duplicates; the default order when empty. */
export function imageProviderOrder(env: Pick<AiEnv, "IMAGE_PROVIDERS">): ImageProviderId[] {
  const listed = (env.IMAGE_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ImageProviderId => (imageProviderIds as readonly string[]).includes(s));
  return listed.length ? [...new Set(listed)] : [...imageProviderIds];
}

/**
 * Default routing: every task on AI_DEFAULT_PROVIDER. Admin settings can
 * override per task (e.g. slides on Claude, scan on OpenAI) by passing `tasks`.
 */
export function defaultRoutingFromEnv(env: AiEnv, providers?: ProviderSet): Routing {
  const primary: ModelRef = {
    provider: env.AI_DEFAULT_PROVIDER,
    model: defaultModelFor(env.AI_DEFAULT_PROVIDER, env),
  };
  const routing: Routing = { default: { primary } };
  if (env.LOCAL_LLM_ENABLED)
    routing.local = { provider: "local", model: defaultModelFor("local", env) };
  // MCP providers (higgsfield, weave) depend on a connection stored in the database:
  // callers add them with mcpImageRoute().
  const keyFor: Record<ImageProviderId, string | undefined> = {
    openai: env.OPENAI_API_KEY,
    google: env.GOOGLE_AI_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    higgsfield: undefined,
    weave: undefined,
  };
  const images: ModelRef[] = imageProviderOrder(env)
    .filter((p) => (providers ? !!providers.image[p] : !!keyFor[p]))
    .map((p) => ({ provider: p, model: imageModelFor(p, env) }));
  if (images[0])
    routing.image = { primary: images[0], ...(images[1] ? { fallback: images[1] } : {}) };
  return routing;
}
