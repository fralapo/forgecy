/**
 * Pexels stock-photo search (https://www.pexels.com/api/). Optional and server-side only:
 * the key comes from `PEXELS_API_KEY` (passed in by the caller) and never reaches the browser, a log or an error
 * message. The Pexels licence allows free commercial use; the API terms ask for a visible
 * link to Pexels and, where possible, to the photographer.
 */
import { ForgecyError, type MessageRef } from "@forgecy/core";
import { UPLOAD_LIMITS } from "./validate";

const API = "https://api.pexels.com/v1";
const TIMEOUT_MS = 10_000;
/** The only host a photo is downloaded from. */
export const PEXELS_IMAGE_HOST = "images.pexels.com";

export const pexelsOrientations = ["portrait", "landscape", "square"] as const;
export type PexelsOrientation = (typeof pexelsOrientations)[number];

export interface PexelsPhoto {
  id: number;
  /** Page of the photo on pexels.com. */
  url: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  width: number;
  height: number;
  avgColor: string;
  /** Preview. */
  srcMedium: string;
  /** Size that fits a 1080 px slide (Pexels `large2x`). */
  srcLarge: string;
  srcOriginal: string;
}

export interface PexelsRateLimit {
  limit: number | null;
  remaining: number | null;
  /** Unix seconds when the window resets. */
  reset: number | null;
}

export type PexelsSearchResult =
  | { configured: false }
  | {
      configured: true;
      photos: PexelsPhoto[];
      page: number;
      perPage: number;
      total: number;
      rateLimit: PexelsRateLimit;
    };

export interface PexelsOptions {
  /** Pass `loadEnv().PEXELS_API_KEY`; empty or absent means "not configured". */
  apiKey?: string | undefined;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const err = (
  code: ConstructorParameters<typeof ForgecyError>[0],
  message: string,
  key: string,
  details?: Record<string, unknown>,
) => new ForgecyError(code, message, details, { key } satisfies MessageRef);

const keyOf = (o?: PexelsOptions) => o?.apiKey?.trim() || null;

export const isPexelsConfigured = (o?: PexelsOptions) => keyOf(o) !== null;

function rateLimitOf(h: Headers): PexelsRateLimit {
  const n = (name: string) => {
    const v = Number(h.get(name));
    return h.get(name) && Number.isFinite(v) ? v : null;
  };
  return {
    limit: n("x-ratelimit-limit"),
    remaining: n("x-ratelimit-remaining"),
    reset: n("x-ratelimit-reset"),
  };
}

/** GET on the Pexels API; one retry on 5xx, 10 s timeout. Error messages never carry the key or the URL. */
async function api(path: string, key: string, o?: PexelsOptions) {
  const doFetch = o?.fetch ?? fetch;
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await doFetch(`${API}${path}`, {
        headers: { Authorization: key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw err("unavailable", "Pexels is unreachable", "content.errors.pexelsUnreachable");
    }
    if (res.status < 500) break;
  }
  if (!res || res.status >= 500)
    throw err("provider_error", "Pexels failed to answer", "content.errors.pexelsUnreachable");
  const rateLimit = rateLimitOf(res.headers);
  if (res.status === 429)
    throw err("unavailable", "Pexels rate limit reached", "content.errors.pexelsRateLimited", {
      rateLimited: true,
      reset: rateLimit.reset,
    });
  if (res.status === 401 || res.status === 403)
    throw err("provider_error", "Pexels rejected the API key", "content.errors.pexelsKeyRejected");
  if (res.status === 404)
    throw err("not_found", "Photo not found on Pexels", "content.errors.pexelsPhotoNotFound");
  if (!res.ok)
    throw err(
      "provider_error",
      `Pexels answered ${res.status}`,
      "content.errors.pexelsUnreachable",
    );
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw err(
      "provider_error",
      "Pexels answered with invalid data",
      "content.errors.pexelsUnreachable",
    );
  }
  return { body, rateLimit };
}

interface RawPhoto {
  id?: unknown;
  url?: unknown;
  photographer?: unknown;
  photographer_url?: unknown;
  alt?: unknown;
  width?: unknown;
  height?: unknown;
  avg_color?: unknown;
  src?: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Normalised photo, or null when a field the app relies on is missing. */
export function normalizePexelsPhoto(raw: unknown): PexelsPhoto | null {
  const p = raw as RawPhoto | null;
  if (!p || typeof p !== "object" || typeof p.id !== "number") return null;
  const src = p.src ?? {};
  const medium = str(src.medium);
  const large = str(src.large2x) || str(src.large);
  const original = str(src.original);
  if (!str(p.url) || !medium || !large || !original) return null;
  return {
    id: p.id,
    url: str(p.url),
    photographer: str(p.photographer).trim() || "Pexels",
    photographerUrl: str(p.photographer_url),
    alt: str(p.alt).trim(),
    width: Number(p.width) || 0,
    height: Number(p.height) || 0,
    avgColor: str(p.avg_color),
    srcMedium: medium,
    srcLarge: large,
    srcOriginal: original,
  };
}

/** Search photos. Without a key it returns `{ configured: false }` instead of failing. */
export async function searchPexels(
  input: { query: string; orientation?: PexelsOrientation; page?: number; perPage?: number },
  o?: PexelsOptions,
): Promise<PexelsSearchResult> {
  const key = keyOf(o);
  if (!key) return { configured: false };
  const query = input.query.trim().slice(0, 200);
  if (!query) throw err("validation", "Empty search", "content.errors.pexelsQueryRequired");
  const qs = new URLSearchParams({
    query,
    page: String(Math.max(1, Math.floor(input.page ?? 1))),
    per_page: String(Math.min(40, Math.max(1, Math.floor(input.perPage ?? 15)))),
  });
  if (input.orientation) qs.set("orientation", input.orientation);
  const { body, rateLimit } = await api(`/search?${qs}`, key, o);
  const b = body as {
    photos?: unknown[];
    page?: number;
    per_page?: number;
    total_results?: number;
  };
  const photos = (b.photos ?? []).map(normalizePexelsPhoto).filter((p): p is PexelsPhoto => !!p);
  return {
    configured: true,
    photos,
    page: Number(b.page) || 1,
    perPage: Number(b.per_page) || photos.length,
    total: Number(b.total_results) || 0,
    rateLimit,
  };
}

/** One photo by id (the server trusts Pexels' answer, never a URL sent by the browser). */
export async function getPexelsPhoto(id: number, o?: PexelsOptions): Promise<PexelsPhoto | null> {
  const key = keyOf(o);
  if (!key) return null;
  if (!Number.isSafeInteger(id) || id <= 0)
    throw err("validation", "Invalid photo id", "content.errors.pexelsPhotoNotFound");
  const { body } = await api(`/photos/${id}`, key, o);
  return normalizePexelsPhoto(body);
}

/** Only https://images.pexels.com, no credentials, no custom port. */
export function assertPexelsImageUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw err("validation", "Invalid image URL", "content.errors.pexelsHostNotAllowed");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== PEXELS_IMAGE_HOST ||
    u.port ||
    u.username ||
    u.password
  )
    throw err("validation", "Image host not allowed", "content.errors.pexelsHostNotAllowed");
  return u;
}

/** Download a Pexels image into memory, capped at the image upload limit; the type is checked by the caller's ingestion. */
export async function downloadPexelsImage(
  url: string,
  o?: Pick<PexelsOptions, "fetch">,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const u = assertPexelsImageUrl(url);
  const cap = UPLOAD_LIMITS.image;
  let res: Response;
  try {
    res = await (o?.fetch ?? fetch)(u, {
      signal: AbortSignal.timeout(TIMEOUT_MS * 3),
      redirect: "error",
    });
  } catch {
    throw err("unavailable", "Pexels is unreachable", "content.errors.pexelsUnreachable");
  }
  if (!res.ok || !res.body)
    throw err(
      "provider_error",
      `Image download failed (${res.status})`,
      "content.errors.pexelsUnreachable",
    );
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime.startsWith("image/"))
    throw err("validation", "Not an image", "content.errors.pexelsNotImage");
  const declared = Number(res.headers.get("content-length"));
  if (declared > cap) throw err("validation", "Image too large", "content.errors.pexelsTooLarge");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += c.length;
    if (total > cap) throw err("validation", "Image too large", "content.errors.pexelsTooLarge");
    chunks.push(c);
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), mime };
}
