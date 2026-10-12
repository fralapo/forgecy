import type { ProviderId } from "@forgecy/core";
import { eq, mcpConnections, type Database } from "@forgecy/db";
import { decryptSecret, encryptSecret } from "../crypto";
import type { McpAuthState, McpAuthStore } from "./oauth";

const AAD = "forgecy:mcp_connections";

/** `McpAuthStore` on the `mcp_connections` row of one provider, encrypted at rest. */
export function createDbMcpAuthStore(
  db: Database,
  provider: ProviderId,
  serverUrl: string,
  encryptionKey: string | undefined,
): McpAuthStore {
  async function read(): Promise<McpAuthState> {
    const [row] = await db
      .select({ encryptedState: mcpConnections.encryptedState })
      .from(mcpConnections)
      .where(eq(mcpConnections.provider, provider));
    if (!row?.encryptedState) return {};
    return JSON.parse(decryptSecret(row.encryptedState, encryptionKey, AAD)) as McpAuthState;
  }

  async function write(state: McpAuthState, extra: { oauthState?: string | null } = {}) {
    const encryptedState = encryptSecret(JSON.stringify(state), encryptionKey, AAD);
    await db
      .insert(mcpConnections)
      .values({ provider, serverUrl, encryptedState, ...extra })
      .onConflictDoUpdate({
        target: mcpConnections.provider,
        set: { serverUrl, encryptedState, ...extra },
      });
  }

  return {
    load: read,
    async save(patch) {
      const next: McpAuthState = { ...(await read()), ...patch };
      for (const k of Object.keys(patch) as (keyof McpAuthState)[])
        if (patch[k] === undefined) delete next[k];
      await write(next);
    },
    async saveOAuthState(state) {
      await write(await read(), { oauthState: state });
    },
    async clear(scope) {
      if (scope === "all") return write({}, { oauthState: null });
      const s = await read();
      if (scope === "client") delete s.clientInformation;
      if (scope === "tokens") delete s.tokens;
      if (scope === "verifier") delete s.codeVerifier;
      await write(s);
    },
  };
}
