import type { Env, ProviderId } from "@forgecy/core";
import { and, eq, mcpConnections, type Database } from "@forgecy/db";
import type { ImageProvider } from "../types";
import { createMcpToolCaller } from "./client";
import { createHiggsfieldImageProvider, createWeaveImageProvider } from "./images";
import { StoredMcpOAuthProvider } from "./oauth";
import { createDbMcpAuthStore } from "./store";

/** Image providers reached over MCP with OAuth instead of an API key. */
export const mcpImageProviderIds = ["higgsfield", "weave"] as const satisfies readonly ProviderId[];
export type McpImageProviderId = (typeof mcpImageProviderIds)[number];

export function isMcpImageProvider(p: string): p is McpImageProviderId {
  return (mcpImageProviderIds as readonly string[]).includes(p);
}

export type McpEnv = Pick<
  Env,
  | "FORGECY_BASE_URL"
  | "FORGECY_ENCRYPTION_KEY"
  | "HIGGSFIELD_MCP_URL"
  | "HIGGSFIELD_IMAGE_MODEL"
  | "FIGMA_MCP_URL"
  | "WEAVE_IMAGE_MODEL"
  | "WEAVE_MAX_CREDITS_PER_IMAGE"
  | "OPENROUTER_IMAGE_MODEL"
  | "IMAGE_PROVIDERS"
>;

export function mcpServerUrl(provider: McpImageProviderId, env: McpEnv): string {
  return provider === "higgsfield" ? env.HIGGSFIELD_MCP_URL : env.FIGMA_MCP_URL;
}

/** Where the authorization server sends the Admin's browser back. */
export function mcpRedirectUrl(env: Pick<Env, "FORGECY_BASE_URL">): string {
  return new URL("/api/mcp/callback", env.FORGECY_BASE_URL).toString();
}

export function mcpOAuthProvider(db: Database, provider: McpImageProviderId, env: McpEnv) {
  return new StoredMcpOAuthProvider({
    store: createDbMcpAuthStore(
      db,
      provider,
      mcpServerUrl(provider, env),
      env.FORGECY_ENCRYPTION_KEY,
    ),
    redirectUrl: mcpRedirectUrl(env),
  });
}

/**
 * MCP image providers, one per provider, whatever the connection state: a provider that
 * is not connected fails with an `auth` error. Use `mcpImageRoute` to route only to
 * connected ones. Needs FORGECY_ENCRYPTION_KEY (returns none without it).
 */
export function createMcpImageProviders(
  db: Database,
  env: McpEnv,
): Partial<Record<McpImageProviderId, ImageProvider>> {
  if (!env.FORGECY_ENCRYPTION_KEY) return {};
  const caller = (provider: McpImageProviderId) =>
    createMcpToolCaller({
      provider,
      serverUrl: mcpServerUrl(provider, env),
      authProvider: mcpOAuthProvider(db, provider, env),
    });
  return {
    higgsfield: createHiggsfieldImageProvider({ caller: caller("higgsfield") }),
    weave: createWeaveImageProvider({
      caller: caller("weave"),
      maxCreditsPerImage: env.WEAVE_MAX_CREDITS_PER_IMAGE,
    }),
  };
}

/** MCP providers with a completed authorization. */
export async function connectedMcpProviders(db: Database): Promise<Set<McpImageProviderId>> {
  const rows = await db
    .select({ provider: mcpConnections.provider })
    .from(mcpConnections)
    .where(eq(mcpConnections.status, "connected"));
  return new Set(rows.map((r) => r.provider).filter(isMcpImageProvider));
}

export async function isMcpConnected(db: Database, provider: McpImageProviderId) {
  const [row] = await db
    .select({ id: mcpConnections.id })
    .from(mcpConnections)
    .where(and(eq(mcpConnections.provider, provider), eq(mcpConnections.status, "connected")));
  return !!row;
}
