import { describe, expect, it } from "vitest";
import {
  createHiggsfieldImageProvider,
  finishMcpAuthorization,
  nearestOption,
  parseToolResult,
  startMcpAuthorization,
  StoredMcpOAuthProvider,
  type ImageProvider,
  type McpAuthState,
  type McpAuthStore,
  type McpTool,
  type McpToolCaller,
} from "../src/index";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function imageFetch(): typeof fetch {
  return (async () =>
    new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
}

function fakeCaller(
  tools: McpTool[],
  handler: (name: string, args: Record<string, unknown>) => unknown,
): McpToolCaller & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    listTools: async () => tools,
    callTool: async (name, args) => {
      calls.push({ name, args });
      return handler(name, args);
    },
    close: async () => undefined,
  };
}

async function runToEnd(provider: ImageProvider, model: string, variants: 1 | 2 = 1) {
  let status = await provider.generate({
    model,
    prompt: "a red chair",
    size: { w: 1080, h: 1350 },
    variants,
    timeoutMs: 1000,
  });
  for (let i = 0; i < 10 && (status.state === "running" || status.state === "queued"); i++)
    status = await provider.getStatus(status.jobId);
  return status;
}

describe("MCP helpers", () => {
  it("picks the option nearest to the slide's aspect ratio", () => {
    const size = { w: 1080, h: 1350 };
    expect(nearestOption(["square", "portrait_4_5", "landscape_16_9"], size)).toBe("portrait_4_5");
    expect(nearestOption(["1:1", "3:4", "9:16"], size)).toBe("3:4");
    expect(nearestOption(["auto"], size)).toBeUndefined();
  });

  it("reads structured content, JSON text and inline images", () => {
    expect(parseToolResult({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
    expect(parseToolResult({ content: [{ type: "text", text: '{"b":2}' }] })).toEqual({ b: 2 });
    expect(parseToolResult({ content: [{ type: "text", text: "plain" }] })).toEqual({
      text: "plain",
    });
  });
});

describe("Higgsfield over MCP", () => {
  const generateTool: McpTool = {
    name: "generate_image",
    inputSchema: {
      properties: {
        prompt: { type: "string" },
        model: { type: "string" },
        aspect_ratio: { type: "string", enum: ["square_1_1", "portrait_4_5", "landscape_16_9"] },
      },
      required: ["prompt"],
    },
  };

  it("downloads the image URLs of a synchronous answer", async () => {
    const caller = fakeCaller([generateTool], () => ({
      status: "completed",
      images: [{ url: "https://cdn.higgsfield.ai/out/1.png" }],
    }));
    const status = await runToEnd(
      createHiggsfieldImageProvider({ caller, fetch: imageFetch() }),
      "flux_2",
    );
    expect(caller.calls[0]).toEqual({
      name: "generate_image",
      args: { prompt: "a red chair", aspect_ratio: "portrait_4_5", model: "flux_2" },
    });
    expect(status.state).toBe("succeeded");
    expect(status.images?.[0]?.mimeType).toBe("image/png");
    expect(status.usage?.images).toBe(1);
  });

  it("polls the status tool while the job runs", async () => {
    let polls = 0;
    const caller = fakeCaller(
      [
        generateTool,
        {
          name: "get_generation_status",
          inputSchema: { properties: { job_id: {} }, required: ["job_id"] },
        },
      ],
      (name) => {
        if (name === "generate_image") return { job_id: "j1", status: "queued" };
        polls++;
        return polls < 2
          ? { job_id: "j1", status: "in_progress" }
          : { job_id: "j1", status: "completed", result: "https://cdn.higgsfield.ai/j1.png" };
      },
    );
    const status = await runToEnd(
      createHiggsfieldImageProvider({ caller, fetch: imageFetch() }),
      "",
    );
    expect(caller.calls[0]!.args).not.toHaveProperty("model");
    expect(caller.calls[1]).toEqual({ name: "get_generation_status", args: { job_id: "j1" } });
    expect(status.state).toBe("succeeded");
  });

  it("fails clearly when the server has no image tool", async () => {
    const caller = fakeCaller([{ name: "list_characters" }], () => ({}));
    await expect(
      createHiggsfieldImageProvider({ caller }).generate({
        model: "",
        prompt: "p",
        size: { w: 1, h: 1 },
        variants: 1,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("MCP OAuth", () => {
  function memoryStore(): McpAuthStore & { state: McpAuthState; oauthState?: string } {
    const s: McpAuthStore & { state: McpAuthState; oauthState?: string } = {
      state: {},
      load: async () => ({ ...s.state }),
      save: async (patch) => {
        s.state = { ...s.state, ...patch };
        for (const k of Object.keys(patch) as (keyof McpAuthState)[])
          if (patch[k] === undefined) delete s.state[k];
      },
      saveOAuthState: async (v) => {
        s.oauthState = v;
      },
      clear: async () => {
        s.state = {};
      },
    };
    return s;
  }

  /** Minimal authorization server: discovery, dynamic registration, token endpoint. */
  const authServer: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      return json({
        resource: "https://mcp.example.com/mcp",
        authorization_servers: ["https://auth.example.com"],
      });
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server"))
      return json({
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
      });
    if (url.pathname === "/register") {
      const meta = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ ...meta, client_id: "client-123" }, 201);
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("code") !== "the-code" || !form.get("code_verifier"))
        return json({ error: "invalid_grant" }, 400);
      return json({
        access_token: "at",
        token_type: "Bearer",
        refresh_token: "rt",
        expires_in: 3600,
      });
    }
    return json({}, 404);
  }) as typeof fetch;

  it("registers, sends the browser to the authorization URL, then stores the tokens", async () => {
    const store = memoryStore();
    const provider = new StoredMcpOAuthProvider({
      store,
      redirectUrl: "https://forgecy.example/api/mcp/callback",
    });
    const start = await startMcpAuthorization(provider, "https://mcp.example.com/mcp", authServer);
    expect(start.status).toBe("redirect");
    const url = new URL((start as { url: string }).url);
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(store.oauthState);
    expect(store.state.codeVerifier).toBeTruthy();

    await finishMcpAuthorization(provider, "https://mcp.example.com/mcp", "the-code", authServer);
    expect(store.state.tokens?.access_token).toBe("at");
    expect(store.state.codeVerifier).toBeUndefined();
  });
});
