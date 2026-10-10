import { SourceError } from "../types";
import type { FetchLike, SourceFailure } from "../types";

const BLOCK_MARKERS = [
  "feedback_required",
  "checkpoint_required",
  "challenge_required",
  "login_required",
];

function isBlockBody(body: string): boolean {
  return BLOCK_MARKERS.some((m) => body.includes(m)) || /"require_login"\s*:\s*true/.test(body);
}

/**
 * Maps an HTTP answer to a failure, or null when it is not a failure by status alone.
 * 403 is "unauthorized" here: a caller that knows better (a login wall) says "blocked"
 * through the body markers or the redirect target.
 */
export function classifyHttp(
  status: number,
  bodyText: string,
  location?: string | null,
): SourceFailure | null {
  // A login wall or challenge wins over the status: Instagram sends it as 400, 401, 403 or 429.
  if ([400, 401, 403, 429].includes(status) && isBlockBody(bodyText)) return "blocked";
  // Logged out, a 200 can also be just the wall.
  if (status >= 200 && status < 300 && /"require_login"\s*:\s*true/.test(bodyText))
    return "blocked";
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status >= 300 && status < 400 && location && /\/accounts\/login|\/challenge/.test(location)) {
    return "blocked";
  }
  if (status === 403) return "unauthorized";
  if (status === 0 || status >= 500) return "transport";
  return null;
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function parseJson(text: string): unknown {
  const value = tryParseJson(text);
  if (value === undefined) throw new SourceError("api_drift", "Response is not valid JSON");
  return value;
}

export async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
  return parseJson(await res.text());
}

/** Retry-After as milliseconds (seconds or HTTP date), undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export interface HttpResult {
  status: number;
  text: string;
  location: string | null;
  retryAfterMs: number | undefined;
}

/** One GET. A network error becomes a transport SourceError (message passed through `redact`). */
export async function send(
  fetch: FetchLike,
  url: string,
  headers: Record<string, string>,
  redact: (text: string) => string = (t) => t,
): Promise<HttpResult> {
  try {
    const res = await fetch(url, { method: "GET", headers });
    const text = await res.text();
    return {
      status: res.status,
      text,
      location: res.headers.get("location"),
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SourceError("transport", redact(`Request failed: ${reason}`));
  }
}

export type Json = Record<string, unknown>;

export function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
