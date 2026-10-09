export interface HealthTarget {
  name: string;
  url: string;
  /** Tried in order when `url` does not answer healthy; the result reported is still `url`'s. */
  alternates?: string[];
}
export interface HealthResult {
  name: string;
  ok: boolean;
  line: string;
}

type Env = Record<string, string | undefined>;

// Text from the other end goes to the user's terminal: C0, DEL and C1 controls (ESC, CSI, OSC,
// BEL, newlines) become a space so a reply cannot clear the screen or set the window title.
const printable = (text: string, max = 200) =>
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, max);

/**
 * Host of the web port. Compose binds it to FORGECY_BIND_ADDRESS (default 127.0.0.1), so a
 * specific address is the only place it answers; a wildcard or nothing is reachable on loopback.
 */
function webHost(env: Env): string {
  const bind = env.FORGECY_BIND_ADDRESS?.trim().replace(/^[|]$/g, "");
  if (!bind || bind === "0.0.0.0" || bind === "::") return "127.0.0.1";
  return bind.includes(":") ? `[${bind}]` : bind;
}

/**
 * Where `pnpm forgecy health` looks. Compose publishes the web port and, on loopback only,
 * the worker's health port (FORGECY_WORKER_HEALTH_PORT, default 3001; inside the container the
 * worker is pinned to 3001, whatever WORKER_HEALTH_PORT says). `pnpm dev` runs the worker on the
 * host at WORKER_HEALTH_PORT, so that port is the fallback, never the first choice.
 */
export function healthTargets(env: Env): HealthTarget[] {
  const published = `http://127.0.0.1:${env.FORGECY_WORKER_HEALTH_PORT ?? "3001"}/health`;
  const dev = env.WORKER_HEALTH_PORT && `http://127.0.0.1:${env.WORKER_HEALTH_PORT}/health`;
  const workerUrl = env.FORGECY_WORKER_HEALTH_URL;
  return [
    {
      name: "web",
      url:
        env.FORGECY_WEB_HEALTH_URL ??
        `http://${webHost(env)}:${env.FORGECY_PORT ?? "3000"}/api/health`,
    },
    workerUrl
      ? { name: "worker", url: workerUrl }
      : {
          name: "worker",
          url: published,
          ...(dev && dev !== published ? { alternates: [dev] } : {}),
        },
  ];
}

export async function checkHealth(
  targets: HealthTarget[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<HealthResult[]> {
  const probe = async (name: string, url: string): Promise<HealthResult> => {
    const label = name.padEnd(7);
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return {
        name,
        ok: false,
        line: `${label} unreachable (${printable((error as Error).message)}) at ${url}`,
      };
    }
    // A reply that is not JSON (a proxy's 502 page) is still a reply, not "unreachable".
    const text = (await res.text().catch(() => "")).trim();
    let detail = printable(text);
    let isJson = false;
    try {
      detail = printable(JSON.stringify(JSON.parse(text)));
      isJson = true;
    } catch {
      /* keep the raw text */
    }
    // A 200 that is not JSON is another app on that port, not a Forgecy health reply.
    if (res.ok && !isJson)
      return { name, ok: false, line: `${label} not a health reply at ${url}: ${detail}` };
    return {
      name,
      ok: res.ok,
      line: `${label} ${res.ok ? "ok" : `error ${res.status}`}  ${detail}`,
    };
  };
  return Promise.all(
    targets.map(async ({ name, url, alternates = [] }) => {
      const first = await probe(name, url);
      for (const alt of first.ok ? [] : alternates) {
        const next = await probe(name, alt);
        if (next.ok) return next;
      }
      return first;
    }),
  );
}
