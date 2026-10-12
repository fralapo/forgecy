import type { ByokProviderId } from "../connections";

/**
 * Each BYOK provider's model-list endpoint, shared with connections.ts (testApiKey uses
 * the same endpoints to confirm a pasted key works). OpenRouter's is public; the other
 * three need the provider's own auth scheme.
 *
 * OpenRouter's `GET /models` defaults to `output_modalities=text` when the param is left
 * off (openrouter.ai/docs/api/api-reference/models/get-models) — so a bare request here
 * silently excludes every image-generation model (GPT Image included) from the response.
 * `text,image` is the only pair Forgecy cares about; it also keeps out the audio/video/
 * rerank/embeddings models OpenRouter also lists, which are noise for both model pickers.
 */
export const MODEL_LIST_ENDPOINTS: Record<ByokProviderId, string> = {
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models?output_modalities=text,image",
  deepseek: "https://api.deepseek.com/models",
};

export function modelListHeaders(
  provider: ByokProviderId,
  apiKey: string | undefined,
): Record<string, string> {
  if (!apiKey) return {};
  return provider === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${apiKey}` };
}

export interface CatalogModel {
  id: string;
  name: string;
  /** Unix seconds; 0 when the provider did not report one (e.g. DeepSeek's list). */
  created: number;
  /** Whether this model can generate images, so the image-model field can hide chat models. */
  imageCapable: boolean;
}

/**
 * Whether a model generates images, from whatever metadata its provider's list gives us.
 * OpenRouter reports architecture.output_modalities; OpenAI's /v1/models has no modality
 * field at all, so its GPT Image / DALL·E models are recognized by id instead. Anthropic
 * and DeepSeek offer no image-generation models through these endpoints.
 */
function isImageCapable(
  provider: ByokProviderId,
  id: string,
  raw: Record<string, unknown>,
): boolean {
  if (provider === "openrouter") {
    const architecture = raw.architecture as Record<string, unknown> | undefined;
    const outputs = architecture?.output_modalities;
    return Array.isArray(outputs) && outputs.includes("image");
  }
  if (provider === "openai") return /^(gpt-image|dall-e)/.test(id);
  return false;
}

/** Parses each provider's own list shape into the common {id, name, created, imageCapable}. */
function normalize(provider: ByokProviderId, json: unknown): CatalogModel[] {
  const data = (json as { data?: unknown[] } | undefined)?.data ?? [];
  return data.flatMap((raw): CatalogModel[] => {
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string") return [];
    const imageCapable = isImageCapable(provider, m.id, m);
    if (provider === "anthropic") {
      // Anthropic's models report `created_at` as an ISO 8601 string, not unix seconds.
      const parsed = typeof m.created_at === "string" ? Date.parse(m.created_at) / 1000 : NaN;
      return [
        {
          id: m.id,
          name: typeof m.display_name === "string" ? m.display_name : m.id,
          created: Number.isFinite(parsed) ? parsed : 0,
          imageCapable,
        },
      ];
    }
    return [
      {
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        created: typeof m.created === "number" ? m.created : 0,
        imageCapable,
      },
    ];
  });
}

const cache = new Map<string, { at: number; models: Promise<CatalogModel[]> }>();
const CACHE_MS = 10 * 60_000;

/**
 * A provider's live model list, cached 10 minutes per (provider, key-present) pair so
 * a pasted key change is picked up without waiting out a stale cache. Throws on a
 * network or HTTP failure (missing/invalid key, provider down); callers that need a
 * best-effort list rather than a hard error should catch and fall back to `[]`.
 */
export async function fetchModelCatalog(
  provider: ByokProviderId,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<CatalogModel[]> {
  const cacheKey = `${provider}:${apiKey ? "key" : "nokey"}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < CACHE_MS) return hit.models;
  const models = (async () => {
    const res = await fetchImpl(MODEL_LIST_ENDPOINTS[provider], {
      headers: modelListHeaders(provider, apiKey),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`${provider} models HTTP ${res.status}`);
    return normalize(provider, await res.json());
  })();
  cache.set(cacheKey, { at: now, models });
  models.catch(() => cache.delete(cacheKey));
  return models;
}

/** For tests: forces the next `fetchModelCatalog` call for this provider to fetch again. */
export function clearModelCatalogCache(provider?: ByokProviderId): void {
  if (!provider) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) if (key.startsWith(`${provider}:`)) cache.delete(key);
}
