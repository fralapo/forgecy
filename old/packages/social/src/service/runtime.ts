import { SOCIAL_LIMITS, type Env } from "@forgecy/core";
import { createCircuitBreaker, type CircuitBreaker } from "../net/breaker";
import { createGuard } from "../net/guard";
import { createRateController, type RateController } from "../net/rate-controller";
import { createGraphApiSource } from "../sources/graph-api";
import { createPublicBrowserSource, type BrowserLauncher } from "../sources/public-browser";
import type { FetchLike, ProfileSource, SnapshotSource } from "../types";

export type SocialEnv = Pick<
  Env,
  | "INSTAGRAM_GRAPH_TOKEN"
  | "INSTAGRAM_GRAPH_USER_ID"
  | "INSTAGRAM_GRAPH_VERSION"
  | "FORGECY_SOCIAL_PUBLIC_WEB"
>;

/** Sources that read from the network. `file_import` has no adapter: it arrives through the audit. */
export type LiveSource = Exclude<SnapshotSource, "file_import">;
export const liveSources: readonly LiveSource[] = ["graph_api", "public_web"];

export interface SocialRuntime {
  /** Sources that are configured in this installation, best first. */
  available(): LiveSource[];
  /** A source with a fresh request budget; the pacing windows and the breaker are shared. */
  open(source: LiveSource): ProfileSource | undefined;
  breaker(source: LiveSource): CircuitBreaker;
}

/** Plain fetch for the adapters: a timeout, no credentials, and redirects are returned, not followed. */
export const defaultFetch: FetchLike = (url, init) =>
  fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers ?? {},
    redirect: "manual",
    credentials: "omit",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

export interface RuntimeOptions {
  fetch?: FetchLike;
  now?: () => Date;
  /** Chromium for the public web source. Only the worker has one: without it the source cannot open. */
  launcher?: BrowserLauncher;
}

const PUBLIC_WEB_REQUESTS_PER_RUN = 10;

/**
 * The pacing policy of each source. Graph API calls are generous (official, per-token limits);
 * the public web source is deliberately slow, and any challenge stops it for good until a
 * person resumes it.
 */
export function createSocialRuntime(env: SocialEnv, options: RuntimeOptions = {}): SocialRuntime {
  const fetchImpl = options.fetch ?? defaultFetch;
  const rates: Record<LiveSource, RateController> = {
    graph_api: createRateController({
      windows: [{ bucket: "graph_api", limit: 150, windowMs: 3_600_000 }],
      jitter: { baseMs: 300, maxMs: 2_000 },
    }),
    public_web: createRateController({
      windows: [
        { bucket: "public_web", limit: 30, windowMs: 10 * 60_000 },
        { bucket: "public_web", limit: 90, windowMs: 3_600_000 },
      ],
      jitter: { baseMs: 3_000, maxMs: 12_000 },
    }),
  };
  const breakers: Record<LiveSource, CircuitBreaker> = {
    graph_api: createCircuitBreaker({ failureThreshold: 3, openMs: 10 * 60_000 }),
    public_web: createCircuitBreaker({ failureThreshold: 2, openMs: 30 * 60_000 }),
  };

  const token = env.INSTAGRAM_GRAPH_TOKEN?.trim();
  const userId = env.INSTAGRAM_GRAPH_USER_ID?.trim();
  const configured: Record<LiveSource, boolean> = {
    graph_api: Boolean(token && userId),
    public_web: env.FORGECY_SOCIAL_PUBLIC_WEB,
  };

  function guardFor(source: LiveSource) {
    return createGuard({
      rate: rates[source],
      breaker: breakers[source],
      // A browser read is the profile plus one page per detailed post.
      maxRequests:
        source === "public_web" ? PUBLIC_WEB_REQUESTS_PER_RUN : SOCIAL_LIMITS.maxRequestsPerRun,
    });
  }

  return {
    available: () => liveSources.filter((s) => configured[s]),
    open(source) {
      if (!configured[source]) return undefined;
      const now = options.now;
      if (source === "graph_api") {
        return createGraphApiSource({
          fetch: fetchImpl,
          guard: guardFor(source),
          accessToken: token!,
          igUserId: userId!,
          apiVersion: env.INSTAGRAM_GRAPH_VERSION,
          ...(now ? { now } : {}),
        });
      }
      if (!options.launcher) return undefined;
      return createPublicBrowserSource({
        launcher: options.launcher,
        guard: guardFor(source),
        enabled: true,
        ...(now ? { now } : {}),
      });
    },
    breaker: (source) => breakers[source],
  };
}
