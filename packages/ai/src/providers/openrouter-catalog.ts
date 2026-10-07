import { clearModelCatalogCache, fetchModelCatalog, type CatalogModel } from "./model-catalog";

/**
 * OpenRouter's catalog-derived defaults: when the Admin leaves a model field empty,
 * routing picks the newest matching model instead of a hardcoded id, so "latest DeepSeek
 * Flash" or "latest GPT image model" stays correct as OpenRouter adds and retires models.
 * (The raw fetch/cache lives in model-catalog.ts, shared with every BYOK provider's
 * searchable model field in Settings.)
 */
export type OpenRouterModelInfo = CatalogModel;

/** The full OpenRouter catalog (cached; see model-catalog.ts). No API key required. */
export function fetchOpenRouterCatalog(fetchImpl?: typeof fetch): Promise<CatalogModel[]> {
  return fetchModelCatalog("openrouter", undefined, fetchImpl);
}

/** For tests: forces the next `fetchOpenRouterCatalog` call to fetch again. */
export function clearOpenRouterCatalogCache(): void {
  clearModelCatalogCache("openrouter");
}

/** A pinned id (not an alias, not a batch variant) usable as a default. */
function isCanonicalModelId(id: string): boolean {
  return !id.startsWith("~") && !id.endsWith(":batch") && !id.endsWith(":free");
}

function newestMatch(
  models: CatalogModel[],
  isMatch: (m: CatalogModel) => boolean,
): string | undefined {
  return models
    .filter((m) => isCanonicalModelId(m.id) && isMatch(m))
    .sort((a, b) => b.created - a.created)[0]?.id;
}

/** DeepSeek's "Flash" chat model, the fast/cheap tier of its lineup. */
export function latestDeepSeekFlashChat(models: CatalogModel[]): string | undefined {
  return newestMatch(models, (m) => m.id.startsWith("deepseek/") && /flash/i.test(m.id));
}

/** OpenAI's image-generation model (GPT Image, formerly DALL-E), served through OpenRouter. */
export function latestOpenAiImageModel(models: CatalogModel[]): string | undefined {
  return newestMatch(models, (m) => m.id.startsWith("openai/") && /gpt-image|dall-e/i.test(m.id));
}

export interface OpenRouterLiveDefaults {
  text?: string;
  image?: string;
}

/**
 * The best available OpenRouter defaults right now: latest DeepSeek Flash for text,
 * latest OpenAI image model for images. Never throws — a network failure (no internet,
 * OpenRouter down) just means no live default, and callers fall back to their own
 * last-known-good constant.
 */
export async function resolveOpenRouterLiveDefaults(
  fetchImpl?: typeof fetch,
): Promise<OpenRouterLiveDefaults> {
  try {
    const models = await fetchOpenRouterCatalog(fetchImpl);
    return { text: latestDeepSeekFlashChat(models), image: latestOpenAiImageModel(models) };
  } catch {
    return {};
  }
}
