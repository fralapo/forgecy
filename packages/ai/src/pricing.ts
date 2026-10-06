import type { ProviderId } from "@forgecy/core";
import type { Usage } from "./types";

/**
 * List prices in USD per million tokens. A plain table on purpose: edit it when
 * providers change prices. ALWAYS re-check against the provider pricing pages
 * (anthropic.com/pricing, developers.openai.com/api/docs/pricing,
 * ai.google.dev/pricing, openrouter.ai/models) before relying on budgets.
 * Last checked: 2026-10-05.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** Cache read price; defaults to 10% of input. */
  cacheRead?: number;
  /** Cache write price; defaults to 125% of input (Anthropic 5-minute TTL). */
  cacheWrite?: number;
  /** Flat price per generated image, for providers that bill per image. */
  perImage?: number;
}

export const priceTable: Record<string, ModelPrice> = {
  // Anthropic
  "anthropic:claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "anthropic:claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "anthropic:claude-opus-5": { input: 5, output: 25 },
  "anthropic:claude-sonnet-5": { input: 2, output: 10 },
  "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
  // OpenAI (text)
  "openai:gpt-6-astra": { input: 10, output: 50, cacheRead: 1 },
  "openai:gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1 },
  "openai:gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // OpenAI (images, token-billed: text input / image output)
  "openai:gpt-image-2": { input: 2.5, output: 15 },
  "openai:gpt-image-2.5-flare": { input: 2.5, output: 15 },
  // DeepSeek: peak-hour list prices (off-peak is about half), TO VERIFY on
  // api-docs.deepseek.com/quick_start/pricing. Checked 2026-10-06.
  "deepseek:deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006 },
  "deepseek:deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044 },
  // OpenRouter (text and images) reports the billed cost itself (usage.cost), so it needs no rows.
  // Google images: per-image estimate, TO VERIFY on ai.google.dev/pricing.
  "google:gemini-3.1-flash-image": { input: 0, output: 0, perImage: 0.04 },
};

export interface CostResult {
  costMicroUsd: number;
  /** False when the model is not in the table (cost recorded as 0, flagged in the log). */
  priced: boolean;
}

/**
 * Cost in micro-USD. USD per million tokens times tokens is exactly micro-USD,
 * so `tokens * pricePerMTok` needs no further scaling.
 */
export function computeCost(provider: ProviderId, model: string, usage: Usage): CostResult {
  if (usage.providerCostUsd !== undefined)
    return { costMicroUsd: Math.round(usage.providerCostUsd * 1_000_000), priced: true };
  if (provider === "local") return { costMicroUsd: 0, priced: true };
  const price = priceTable[`${provider}:${model}`];
  if (!price) return { costMicroUsd: 0, priced: false };
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const micro =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * cacheRead +
    usage.cacheWriteTokens * cacheWrite +
    (usage.images ?? 0) * (price.perImage ?? 0) * 1_000_000;
  return { costMicroUsd: Math.round(micro), priced: true };
}
