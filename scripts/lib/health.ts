export interface HealthTarget {
  name: string;
  url: string;
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
 * Where `pnpm forgecy health` looks. Compose publishes the web port and, on loopback only,
 * the worker's health port; `pnpm dev` runs both on the host.
 */
export function healthTargets(env: Env): HealthTarget[] {
  const workerPort = env.FORGECY_WORKER_HEALTH_PORT ?? env.WORKER_HEALTH_PORT ?? "3001";
  return [
    {
      name: "web",
      url:
        env.FORGECY_WEB_HEALTH_URL ?? `http://127.0.0.1:${env.FORGECY_PORT ?? "3000"}/api/health`,
    },
    {
      name: "worker",
      url: env.FORGECY_WORKER_HEALTH_URL ?? `http://127.0.0.1:${workerPort}/health`,
    },
  ];
}

export async function checkHealth(
  targets: HealthTarget[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<HealthResult[]> {
  return Promise.all(
    targets.map(async ({ name, url }): Promise<HealthResult> => {
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
    }),
  );
}
