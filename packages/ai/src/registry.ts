import type { Env, ProviderId } from "@forgecy/core";
import type { Routing } from "./gateway";
import { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./providers/anthropic";
import { createGoogleImageProvider, GOOGLE_IMAGE_DEFAULT_MODEL } from "./providers/google-images";
import {
  createOpenAICompatibleProvider,
  LOCAL_DEFAULT_MODEL,
  OPENAI_DEFAULT_MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_DEFAULT_MODEL,
} from "./providers/openai-compatible";
import { createOpenAIImageProvider, OPENAI_IMAGE_DEFAULT_MODEL } from "./providers/openai-images";
import type { ModelRef, ProviderSet } from "./types";

export type AiEnv = Pick<
  Env,
  | "AI_DEFAULT_PROVIDER"
  | "ANTHROPIC_API_KEY"
  | "OPENAI_API_KEY"
  | "OPENROUTER_API_KEY"
  | "GOOGLE_AI_API_KEY"
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
    set.text.openrouter = createOpenAICompatibleProvider({
      id: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      // Optional attribution headers documented by OpenRouter.
      defaultHeaders: {
        "HTTP-Referer": env.FORGECY_BASE_URL ?? "http://localhost:3000",
        "X-Title": "Forgecy",
      },
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
    case "local":
      return env.LOCAL_LLM_MODEL ?? LOCAL_DEFAULT_MODEL;
    case "google":
      return GOOGLE_IMAGE_DEFAULT_MODEL;
  }
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
  const hasOpenAIImages = providers ? !!providers.image.openai : !!env.OPENAI_API_KEY;
  const hasGoogleImages = providers ? !!providers.image.google : !!env.GOOGLE_AI_API_KEY;
  const openaiImg: ModelRef = { provider: "openai", model: OPENAI_IMAGE_DEFAULT_MODEL };
  const googleImg: ModelRef = { provider: "google", model: GOOGLE_IMAGE_DEFAULT_MODEL };
  if (hasOpenAIImages)
    routing.image = { primary: openaiImg, ...(hasGoogleImages ? { fallback: googleImg } : {}) };
  else if (hasGoogleImages) routing.image = { primary: googleImg };
  return routing;
}
