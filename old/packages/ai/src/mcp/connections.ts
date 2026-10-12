import { assertCan, ForgecyError, type Actor } from "@forgecy/core";
import { eq, mcpConnections, recordAuditEvent, type Database } from "@forgecy/db";
import {
  isMcpImageProvider,
  mcpOAuthProvider,
  mcpServerUrl,
  type McpEnv,
  type McpImageProviderId,
} from "./registry";
import { finishMcpAuthorization, startMcpAuthorization } from "./oauth";

/**
 * Admin flows of Settings > AI providers for subscriptions reached over MCP.
 * Only people (never agents) with `ai.providers.manage` connect or disconnect.
 */
function requireAdmin(actor: Actor) {
  assertCan(actor, "ai.providers.manage");
  if (actor.type !== "user")
    throw new ForgecyError("permission_denied", "Agents cannot connect providers");
}

function requireKey(env: McpEnv) {
  if (!env.FORGECY_ENCRYPTION_KEY)
    throw new ForgecyError("unavailable", "FORGECY_ENCRYPTION_KEY is not set", {
      reason: "encryption_key_missing",
    });
}

export interface McpConnectionView {
  provider: McpImageProviderId;
  status: "pending" | "connected" | "error";
  lastError: string | null;
  connectedAt: Date | null;
  connectedBy: string | null;
}

export async function listMcpConnections(
  db: Database,
): Promise<Map<McpImageProviderId, McpConnectionView>> {
  const rows = await db
    .select({
      provider: mcpConnections.provider,
      status: mcpConnections.status,
      lastError: mcpConnections.lastError,
      connectedAt: mcpConnections.connectedAt,
      connectedBy: mcpConnections.connectedBy,
    })
    .from(mcpConnections);
  const out = new Map<McpImageProviderId, McpConnectionView>();
  for (const r of rows)
    if (isMcpImageProvider(r.provider)) out.set(r.provider, { ...r, provider: r.provider });
  return out;
}

/**
 * Start the OAuth authorization: returns the URL to send the Admin's browser to, or
 * `null` when stored tokens are still valid (the connection is then marked connected).
 */
export async function beginMcpConnection(
  db: Database,
  actor: Actor,
  env: McpEnv,
  provider: McpImageProviderId,
): Promise<string | null> {
  requireAdmin(actor);
  requireKey(env);
  const serverUrl = mcpServerUrl(provider, env);
  await db
    .insert(mcpConnections)
    .values({ provider, serverUrl, status: "pending" })
    .onConflictDoUpdate({
      target: mcpConnections.provider,
      set: { serverUrl, status: "pending", lastError: null },
    });
  try {
    const res = await startMcpAuthorization(mcpOAuthProvider(db, provider, env), serverUrl);
    if (res.status === "redirect") return res.url;
  } catch (err) {
    await markError(db, provider, err);
    throw new ForgecyError("provider_error", `Could not start the ${provider} authorization`, {
      provider,
      cause: errorText(err),
    });
  }
  await markConnected(db, actor, provider);
  return null;
}

/** Callback of the authorization server: match `state`, exchange the code, mark connected. */
export async function completeMcpConnection(
  db: Database,
  actor: Actor,
  env: McpEnv,
  input: { state: string; code?: string | null; error?: string | null },
): Promise<McpImageProviderId> {
  requireAdmin(actor);
  requireKey(env);
  const [row] = await db
    .select({ provider: mcpConnections.provider })
    .from(mcpConnections)
    .where(eq(mcpConnections.oauthState, input.state));
  if (!row || !isMcpImageProvider(row.provider))
    throw new ForgecyError("validation", "Unknown or expired authorization");
  const provider = row.provider;
  if (input.error || !input.code) {
    await markError(db, provider, input.error ?? "no authorization code");
    throw new ForgecyError("provider_error", `${provider} authorization was refused`, { provider });
  }
  try {
    await finishMcpAuthorization(
      mcpOAuthProvider(db, provider, env),
      mcpServerUrl(provider, env),
      input.code,
    );
  } catch (err) {
    await markError(db, provider, err);
    throw new ForgecyError("provider_error", `${provider} did not issue tokens`, {
      provider,
      cause: errorText(err),
    });
  }
  await markConnected(db, actor, provider);
  return provider;
}

/** Forget the tokens and the client registration. The subscription itself is untouched. */
export async function disconnectMcp(db: Database, actor: Actor, provider: McpImageProviderId) {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(mcpConnections).where(eq(mcpConnections.provider, provider));
    await recordAuditEvent(tx, {
      actor,
      action: "mcp_provider_disconnected",
      entity: "ai_provider",
      entityId: provider,
    });
  });
}

function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

async function markError(db: Database, provider: McpImageProviderId, err: unknown) {
  await db
    .update(mcpConnections)
    .set({ status: "error", lastError: errorText(err), oauthState: null })
    .where(eq(mcpConnections.provider, provider));
}

async function markConnected(db: Database, actor: Actor, provider: McpImageProviderId) {
  await db.transaction(async (tx) => {
    await tx
      .update(mcpConnections)
      .set({
        status: "connected",
        lastError: null,
        oauthState: null,
        connectedAt: new Date(),
        connectedBy: actor.type === "user" ? actor.id : null,
      })
      .where(eq(mcpConnections.provider, provider));
    await recordAuditEvent(tx, {
      actor,
      action: "mcp_provider_connected",
      entity: "ai_provider",
      entityId: provider,
    });
  });
}
