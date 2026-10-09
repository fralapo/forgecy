import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ProviderId } from "@forgecy/core";
import {
  createHostCheck,
  createPinnedFetch,
  GuardedFetchError,
  guardedFetch,
  readCapped,
  type HostCheck,
} from "@forgecy/core/net-guard";
import { AiProviderError, classifyError } from "../errors";
import type { GeneratedImage, ImageSize } from "../types";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

/** The two MCP operations the image adapters need; a fake in tests. */
export interface McpToolCaller {
  listTools(): Promise<McpTool[]>;
  /** Tool result: `structuredContent`, else the first text block parsed as JSON, else `{ text }`. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

const reconnectHint = "reconnect it in Settings > AI providers";

/**
 * Connect to a remote MCP server over Streamable HTTP with OAuth. The connection is
 * opened lazily and reused; any transport failure drops it so the next call reconnects.
 */
export function createMcpToolCaller(opts: {
  provider: ProviderId;
  serverUrl: string;
  authProvider: OAuthClientProvider;
  fetch?: typeof fetch;
}): McpToolCaller {
  let client: Promise<Client> | undefined;

  function connect(): Promise<Client> {
    client ??= (async () => {
      const c = new Client({ name: "forgecy", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(opts.serverUrl), {
        authProvider: opts.authProvider,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
      await c.connect(transport);
      return c;
    })().catch((err: unknown) => {
      client = undefined;
      throw toProviderError(err, opts.provider);
    });
    return client;
  }

  return {
    async listTools() {
      const c = await connect();
      try {
        const { tools } = await c.listTools();
        return tools as McpTool[];
      } catch (err) {
        client = undefined;
        throw toProviderError(err, opts.provider);
      }
    },
    async callTool(name, args) {
      const c = await connect();
      let res: Awaited<ReturnType<Client["callTool"]>>;
      try {
        res = await c.callTool({ name, arguments: args });
      } catch (err) {
        client = undefined;
        throw toProviderError(err, opts.provider);
      }
      const parsed = parseToolResult(res as { structuredContent?: unknown; content?: unknown });
      if (res.isError) {
        const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        throw new AiProviderError("bad_request", `${name} failed: ${text.slice(0, 300)}`, {
          provider: opts.provider,
        });
      }
      return parsed;
    },
    async close() {
      const c = await client?.catch(() => undefined);
      client = undefined;
      await c?.close().catch(() => undefined);
    },
  };
}

function toProviderError(err: unknown, provider: ProviderId): AiProviderError {
  if (err instanceof UnauthorizedError)
    return new AiProviderError(
      "auth",
      `${provider} is not connected or the login expired: ${reconnectHint}`,
      {
        provider,
        cause: err,
      },
    );
  return classifyError(err, provider);
}

export function parseToolResult(res: { structuredContent?: unknown; content?: unknown }): unknown {
  if (res.structuredContent !== undefined && res.structuredContent !== null)
    return res.structuredContent;
  const blocks = Array.isArray(res.content) ? (res.content as Array<Record<string, unknown>>) : [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  const images = blocks.filter((b) => b.type === "image" && typeof b.data === "string");
  try {
    const json = JSON.parse(text) as unknown;
    return images.length && json && typeof json === "object" ? { ...json, _images: images } : json;
  } catch {
    return images.length ? { text, _images: images } : { text };
  }
}

// ---- Tolerant readers: MCP tool outputs are not a stable contract ----

/** Every http(s) URL found anywhere in a value (strings inside objects and arrays). */
export function collectUrls(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) out.push(m[0]);
  } else if (Array.isArray(value)) value.forEach((v) => collectUrls(v, out));
  else if (value && typeof value === "object")
    Object.values(value as Record<string, unknown>).forEach((v) => collectUrls(v, out));
  return [...new Set(out)];
}

/** First value whose key matches `key`, depth first. */
export function findByKey(value: unknown, key: RegExp): unknown {
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findByKey(v, key);
      if (found !== undefined) return found;
    }
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) if (key.test(k) && v !== undefined && v !== null) return v;
    for (const [, v] of entries) {
      const found = findByKey(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function findString(value: unknown, key: RegExp): string | undefined {
  const v = findByKey(value, key);
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v) && (typeof v[0] === "string" || typeof v[0] === "number"))
    return String(v[0]);
  return undefined;
}

/** Images returned inline as MCP image blocks (base64). */
export function inlineImages(value: unknown): GeneratedImage[] {
  const blocks = (value as { _images?: Array<{ data: string; mimeType?: string }> } | null)
    ?._images;
  return (blocks ?? []).map((b) => ({
    data: new Uint8Array(Buffer.from(b.data, "base64")),
    mimeType: b.mimeType ?? "image/png",
  }));
}

/** Ratio of an option like "4:5", "portrait_4_5", "1024x1536" or "square"; undefined if none. */
export function ratioOf(option: string): number | undefined {
  if (/square/i.test(option)) return 1;
  const m = /(\d+(?:\.\d+)?)\s*[:x_/]\s*(\d+(?:\.\d+)?)/i.exec(option);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : undefined;
}

/** The option whose ratio is closest to `size`; undefined when no option has a ratio. */
export function nearestOption(options: readonly string[], size: ImageSize): string | undefined {
  const target = size.w / size.h;
  let best: { option: string; d: number } | undefined;
  for (const option of options) {
    const r = ratioOf(option);
    if (r === undefined) continue;
    const d = Math.abs(Math.log(r / target));
    if (!best || d < best.d) best = { option, d };
  }
  return best?.option;
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

// Image URLs come out of a remote MCP server's tool result: public hosts only, never
// FORGECY_AUDIT_ALLOW_PRIVATE_HOSTS (that switch is about prospect intranets).
let publicOnly: { hostCheck: HostCheck; fetch: typeof fetch } | undefined;
const publicDefaults = () =>
  (publicOnly ??= { hostCheck: createHostCheck(), fetch: createPinnedFetch() });

/**
 * Download the generated images from the URLs a tool returned. Every redirect hop is
 * host-checked and the connection is DNS-pinned (see @forgecy/core/net-guard); only
 * images up to 30 MiB are kept. A URL that is refused or too big is skipped.
 */
export async function downloadImages(
  urls: readonly string[],
  provider: ProviderId,
  timeoutMs: number,
  doFetch?: typeof fetch,
  hostCheck?: HostCheck,
): Promise<GeneratedImage[]> {
  const images: GeneratedImage[] = [];
  for (const url of urls) {
    let res: Response;
    try {
      ({ res } = await guardedFetch(url, {
        hostCheck: hostCheck ?? publicDefaults().hostCheck,
        fetchImpl: doFetch ?? publicDefaults().fetch,
        timeoutMs,
        maxHops: 3,
      }));
    } catch (err) {
      if (err instanceof GuardedFetchError) continue; // a tool result must not steer us at the local network
      throw classifyError(err, provider);
    }
    const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !type.startsWith("image/") || declared > MAX_IMAGE_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    const { bytes, truncated } = await readCapped(res, MAX_IMAGE_BYTES);
    if (!truncated && bytes.byteLength > 0) images.push({ data: bytes, mimeType: type });
  }
  return images;
}
