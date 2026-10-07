import { assertCan, ForgecyError, type Actor, type Env } from "@forgecy/core";
import { appSettings, eq, recordAuditEvent, siwcConnections, type Database } from "@forgecy/db";
import {
  buildAuthorizationUrl,
  exchangeSiwcCode,
  generatePkce,
  generateState,
  refreshSiwcTokens,
  revokeSiwcToken,
  verifySiwcIdToken,
  type SiwcClientConfig,
} from "./oauth";
import { createSiwcAuthStore } from "./store";

export type SiwcEnv = Pick<
  Env,
  | "FORGECY_BASE_URL"
  | "FORGECY_ENCRYPTION_KEY"
  | "OPENAI_SIWC_CLIENT_ID"
  | "OPENAI_SIWC_CLIENT_SECRET"
>;

const CLIENT_ID_SETTING_KEY = "ai.siwc_client_id";
/** Tokens refreshed once fewer than this many seconds remain, so a call never races expiry. */
const REFRESH_SKEW_SECONDS = 60;

function requireKey(env: SiwcEnv): string {
  if (!env.FORGECY_ENCRYPTION_KEY)
    throw new ForgecyError("unavailable", "FORGECY_ENCRYPTION_KEY is not set", {
      reason: "encryption_key_missing",
    });
  return env.FORGECY_ENCRYPTION_KEY;
}

/** Where OpenAI sends the browser back; must be registered with OpenAI exactly as given. */
export function siwcRedirectUri(env: Pick<Env, "FORGECY_BASE_URL">): string {
  return new URL("/api/auth/siwc/callback", env.FORGECY_BASE_URL).toString();
}

/** An Admin can set the client id from Settings > AI providers; it is not a secret. */
export async function getSiwcClientIdOverride(db: Database): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CLIENT_ID_SETTING_KEY));
  return typeof row?.value === "string" && row.value ? row.value : null;
}

export async function setSiwcClientId(db: Database, actor: Actor, clientId: string): Promise<void> {
  assertCan(actor, "ai.providers.manage");
  const value = clientId.trim();
  const userId = actor.type === "user" ? actor.id : null;
  await db.transaction(async (tx) => {
    if (value) {
      await tx
        .insert(appSettings)
        .values({ key: CLIENT_ID_SETTING_KEY, value, updatedBy: userId })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedBy: userId, updatedAt: new Date() },
        });
    } else {
      await tx.delete(appSettings).where(eq(appSettings.key, CLIENT_ID_SETTING_KEY));
    }
    await recordAuditEvent(tx, {
      actor,
      action: "siwc_client_id_changed",
      entity: "app_settings",
      entityId: CLIENT_ID_SETTING_KEY,
    });
  });
}

/** The client id Forgecy would use: the Admin's override, else `OPENAI_SIWC_CLIENT_ID`. */
export async function siwcClientId(db: Database, env: SiwcEnv): Promise<string | null> {
  return (await getSiwcClientIdOverride(db)) || env.OPENAI_SIWC_CLIENT_ID || null;
}

/** False while OpenAI has not handed Forgecy a client id (the normal state today). */
export async function isSiwcConfigured(db: Database, env: SiwcEnv): Promise<boolean> {
  return (await siwcClientId(db, env)) !== null;
}

async function clientConfig(db: Database, env: SiwcEnv): Promise<SiwcClientConfig> {
  const clientId = await siwcClientId(db, env);
  if (!clientId)
    throw new ForgecyError("unavailable", "OpenAI has not issued Forgecy a SIWC client id yet", {
      reason: "siwc_not_registered",
    });
  return {
    clientId,
    ...(env.OPENAI_SIWC_CLIENT_SECRET ? { clientSecret: env.OPENAI_SIWC_CLIENT_SECRET } : {}),
    redirectUri: siwcRedirectUri(env),
  };
}

export interface SiwcConnectionView {
  status: "pending" | "connected" | "error";
  planSharing: boolean;
  name: string | null;
  email: string | null;
  lastError: string | null;
  connectedAt: Date | null;
}

/** The signed-in person's own connection (never another user's), for their Settings page. */
export async function getSiwcConnection(
  db: Database,
  userId: string,
  env: SiwcEnv,
): Promise<SiwcConnectionView | null> {
  const [row] = await db
    .select({
      status: siwcConnections.status,
      planSharing: siwcConnections.planSharing,
      lastError: siwcConnections.lastError,
      connectedAt: siwcConnections.connectedAt,
    })
    .from(siwcConnections)
    .where(eq(siwcConnections.userId, userId));
  if (!row) return null;
  let name: string | null = null;
  let email: string | null = null;
  if (env.FORGECY_ENCRYPTION_KEY) {
    // The profile is read only for display; a decrypt failure never breaks the page.
    const profile = await createSiwcAuthStore(db, userId, env.FORGECY_ENCRYPTION_KEY)
      .load()
      .then((s) => s.profile)
      .catch(() => undefined);
    name = profile?.name ?? null;
    email = profile?.email ?? null;
  }
  return {
    status: row.status,
    planSharing: row.planSharing,
    name,
    email,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
  };
}

/** Start the OAuth authorization: stores a pending PKCE state and returns the URL to redirect to. */
export async function beginSiwcConnection(
  db: Database,
  actor: Actor,
  env: SiwcEnv,
): Promise<string> {
  if (actor.type !== "user")
    throw new ForgecyError("permission_denied", "Only a signed-in person can connect SIWC");
  const key = requireKey(env);
  const client = await clientConfig(db, env);
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const store = createSiwcAuthStore(db, actor.id, key);
  await db
    .insert(siwcConnections)
    .values({ userId: actor.id, status: "pending" })
    .onConflictDoUpdate({
      target: siwcConnections.userId,
      set: { status: "pending", lastError: null },
    });
  await store.save({ codeVerifier: verifier });
  await store.saveOAuthState(state);
  return buildAuthorizationUrl(client, { state, codeChallenge: challenge });
}

/** Callback: match `state` to the person's pending row, exchange the code, verify the ID token. */
export async function completeSiwcConnection(
  db: Database,
  env: SiwcEnv,
  input: { state: string; code?: string | null; error?: string | null },
): Promise<void> {
  const [row] = await db
    .select({ userId: siwcConnections.userId })
    .from(siwcConnections)
    .where(eq(siwcConnections.oauthState, input.state));
  if (!row) throw new ForgecyError("validation", "Unknown or expired SIWC authorization");
  const key = requireKey(env);
  const store = createSiwcAuthStore(db, row.userId, key);
  if (input.error || !input.code) {
    await markError(db, row.userId, input.error ?? "no authorization code");
    throw new ForgecyError("provider_error", "ChatGPT sign-in was not completed", {
      reason: input.error ?? "no_code",
    });
  }
  const state = await store.load();
  if (!state.codeVerifier) {
    await markError(db, row.userId, "no pending PKCE verifier");
    throw new ForgecyError("validation", "No pending SIWC authorization to complete");
  }
  const client = await clientConfig(db, env);
  try {
    const tokens = await exchangeSiwcCode(client, input.code, state.codeVerifier);
    const profile = await verifySiwcIdToken(tokens.idToken, client.clientId);
    await store.save({ tokens, profile, codeVerifier: undefined });
    await db
      .update(siwcConnections)
      .set({ status: "connected", lastError: null, oauthState: null, connectedAt: new Date() })
      .where(eq(siwcConnections.userId, row.userId));
    await recordAuditEvent(db, {
      actor: "system",
      action: "siwc_connected",
      entity: "user",
      entityId: row.userId,
    });
  } catch (err) {
    await markError(db, row.userId, err);
    throw err instanceof ForgecyError
      ? err
      : new ForgecyError("provider_error", "ChatGPT sign-in failed", {
          cause: err instanceof Error ? err.message : String(err),
        });
  }
}

/** Forgets the tokens and (best effort) revokes them with OpenAI. */
export async function disconnectSiwc(db: Database, actor: Actor, env: SiwcEnv): Promise<void> {
  if (actor.type !== "user")
    throw new ForgecyError("permission_denied", "Only a signed-in person can disconnect SIWC");
  const key = requireKey(env);
  const store = createSiwcAuthStore(db, actor.id, key);
  const state = await store.load();
  if (state.tokens?.refreshToken || state.tokens?.accessToken) {
    const client = await clientConfig(db, env).catch(() => null);
    if (client) {
      const token = state.tokens.refreshToken ?? state.tokens.accessToken;
      await revokeSiwcToken(client, token);
    }
  }
  await db.delete(siwcConnections).where(eq(siwcConnections.userId, actor.id));
  await recordAuditEvent(db, {
    actor,
    action: "siwc_disconnected",
    entity: "user",
    entityId: actor.id,
  });
}

async function markError(db: Database, userId: string, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  await db
    .update(siwcConnections)
    .set({ status: "error", lastError: message, oauthState: null })
    .where(eq(siwcConnections.userId, userId));
}

/**
 * A valid access token for the person's connection, refreshing first if it is near
 * expiry. Returns `null` when not connected — callers fall back to the agency's API key.
 */
export async function validSiwcAccessToken(
  db: Database,
  userId: string,
  env: SiwcEnv,
): Promise<string | null> {
  const key = requireKey(env);
  const store = createSiwcAuthStore(db, userId, key);
  const state = await store.load();
  if (!state.tokens) return null;
  const now = Math.floor(Date.now() / 1000);
  if (state.tokens.expiresAt - now > REFRESH_SKEW_SECONDS) return state.tokens.accessToken;
  if (!state.tokens.refreshToken) return null;
  try {
    const client = await clientConfig(db, env);
    const refreshed = await refreshSiwcTokens(client, state.tokens.refreshToken);
    await store.save({ tokens: refreshed });
    return refreshed.accessToken;
  } catch (err) {
    await markError(db, userId, err);
    return null;
  }
}
