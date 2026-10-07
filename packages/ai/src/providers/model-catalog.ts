import type { ByokProviderId } from "../connections";

/**
 * Each BYOK provider's model-list endpoint, shared with connections.ts (testApiKey uses
 * the same endpoints to confirm a pasted key works). OpenRouter's is public; the other
 * three need the provider's own auth scheme.
 */
export const MODEL_LIST_ENDPOINTS: Record<ByokProviderId, string> = {
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
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
}

/** Parses each provider's own list shape into the common {id, name, created}. */
function normalize(provider: ByokProviderId, json: unknown): CatalogModel[] {
  const data = (json as { data?: unknown[] } | undefined)?.data ?? [];
  return data.flatMap((raw): CatalogModel[] => {
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== "string") return [];
    if (provider === "anthropic") {
      // Anthropic's models report `created_at` as an ISO 8601 string, not unix seconds.
      const parsed = typeof m.created_at === "string" ? Date.parse(m.created_at) / 1000 : NaN;
      return [
        {
          id: m.id,
          name: typeof m.display_name === "string" ? m.display_name : m.id,
          created: Number.isFinite(parsed) ? parsed : 0,
        },
      ];
    }
    return [
      {
        id: m.id,
        name: typeof m.name === "string" ? m.name : m.id,
        created: typeof m.created === "number" ? m.created : 0,
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
