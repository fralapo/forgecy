/**
 * OpenRouter's public model catalog, used two ways:
 * - Settings > AI providers lets the Admin search it instead of typing a model id blind.
 * - When the Admin leaves a model field empty, routing picks the newest matching model
 *   from this catalog instead of a hardcoded id, so "latest DeepSeek Flash" or "latest
 *   GPT image model" stays correct as OpenRouter adds and retires models.
 *
 * The endpoint lists every model OpenRouter offers and needs no API key. Reference:
 * openrouter.ai/docs/api-reference/list-available-models (checked 2026-10-07).
 */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterModelInfo {
  id: string;
  name: string;
  /** Unix seconds; 0 when OpenRouter did not report one. */
  created: number;
}

interface RawOpenRouterModel {
  id?: unknown;
  name?: unknown;
  created?: unknown;
}

let cache: { at: number; models: Promise<OpenRouterModelInfo[]> } | undefined;
const CACHE_MS = 10 * 60_000;

/** A pinned id (not an alias, not a batch variant) usable as a default. */
function isCanonicalModelId(id: string): boolean {
  return !id.startsWith("~") && !id.endsWith(":batch") && !id.endsWith(":free");
}

/**
 * The full catalog, cached in memory for `CACHE_MS` so Settings and routing resolution
 * do not refetch on every call. Throws on a network or HTTP failure; callers that need a
 * default rather than a browsable list should go through `resolveOpenRouterLiveDefaults`,
 * which turns a failure into "no live default" instead of breaking the caller.
 */
export async function fetchOpenRouterCatalog(
  fetchImpl: typeof fetch = fetch,
): Promise<OpenRouterModelInfo[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.models;
  const models = (async () => {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`OpenRouter models HTTP ${res.status}`);
    const json = (await res.json()) as { data?: RawOpenRouterModel[] };
    return (json.data ?? [])
      .filter((m): m is RawOpenRouterModel & { id: string } => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        created: typeof m.created === "number" ? m.created : 0,
      }));
  })();
  cache = { at: now, models };
  // A failed fetch must not poison the cache for the next call.
  models.catch(() => {
    cache = undefined;
  });
  return models;
}

/** For tests: forces the next `fetchOpenRouterCatalog` call to fetch again. */
export function clearOpenRouterCatalogCache(): void {
  cache = undefined;
}

function newestMatch(
  models: OpenRouterModelInfo[],
  isMatch: (m: OpenRouterModelInfo) => boolean,
): string | undefined {
  return models
    .filter((m) => isCanonicalModelId(m.id) && isMatch(m))
    .sort((a, b) => b.created - a.created)[0]?.id;
}

/** DeepSeek's "Flash" chat model, the fast/cheap tier of its lineup. */
export function latestDeepSeekFlashChat(models: OpenRouterModelInfo[]): string | undefined {
  return newestMatch(models, (m) => m.id.startsWith("deepseek/") && /flash/i.test(m.id));
}

/** OpenAI's image-generation model (GPT Image, formerly DALL-E), served through OpenRouter. */
export function latestOpenAiImageModel(models: OpenRouterModelInfo[]): string | undefined {
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
