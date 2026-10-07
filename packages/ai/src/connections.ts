import { assertCan, ForgecyError, type Actor, type Env } from "@forgecy/core";
import { aiConnections, and, eq, isNull, recordAuditEvent, type Database } from "@forgecy/db";
import { decryptSecret, encryptSecret, keyHint as lastFour } from "./crypto";
import { MODEL_LIST_ENDPOINTS, modelListHeaders } from "./providers/model-catalog";

/**
 * Agency-wide BYOK API keys pasted in Settings > AI providers, as an alternative to
 * setting the provider's env var. Every provider whose env var is a single bearer-style
 * key (`${PROVIDER}_API_KEY`); local models have no key and MCP providers (Higgsfield)
 * use OAuth instead.
 */
export const byokProviderIds = ["openai", "anthropic", "openrouter", "deepseek"] as const;
export type ByokProviderId = (typeof byokProviderIds)[number];

export type ByokEnv = Pick<Env, "FORGECY_ENCRYPTION_KEY">;
type ByokApiKeyEnv = ByokEnv & {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
};

function requireKey(env: ByokEnv): string {
  if (!env.FORGECY_ENCRYPTION_KEY)
    throw new ForgecyError("unavailable", "FORGECY_ENCRYPTION_KEY is not set", {
      reason: "encryption_key_missing",
    });
  return env.FORGECY_ENCRYPTION_KEY;
}

function requireAdmin(actor: Actor): asserts actor is Actor & { type: "user" } {
  assertCan(actor, "ai.providers.manage");
  if (actor.type !== "user")
    throw new ForgecyError("permission_denied", "Agents cannot manage API keys");
}

const agencyScope = (provider: ByokProviderId) =>
  and(
    eq(aiConnections.scope, "agency"),
    isNull(aiConnections.scopeId),
    eq(aiConnections.provider, provider),
  );

export interface ByokConnectionView {
  keyHint: string;
  status: "active" | "disabled";
}

/** The agency's own pasted key for a provider, for display only (never the raw key). */
export async function getAgencyApiKey(
  db: Database,
  provider: ByokProviderId,
): Promise<ByokConnectionView | null> {
  const [row] = await db
    .select({ keyHint: aiConnections.keyHint, status: aiConnections.status })
    .from(aiConnections)
    .where(agencyScope(provider));
  return row ?? null;
}

/** Save (or replace) the agency's pasted key for a provider, encrypted at rest. */
export async function setAgencyApiKey(
  db: Database,
  actor: Actor,
  env: ByokEnv,
  provider: ByokProviderId,
  apiKey: string,
): Promise<void> {
  requireAdmin(actor);
  const key = requireKey(env);
  const value = apiKey.trim();
  if (!value) throw new ForgecyError("validation", "The API key is empty");
  const encryptedKey = encryptSecret(value, key);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: aiConnections.id })
      .from(aiConnections)
      .where(agencyScope(provider));
    if (existing) {
      await tx
        .update(aiConnections)
        .set({ encryptedKey, keyHint: lastFour(value), status: "active" })
        .where(eq(aiConnections.id, existing.id));
    } else {
      await tx.insert(aiConnections).values({
        scope: "agency",
        provider,
        encryptedKey,
        keyHint: lastFour(value),
        createdBy: actor.id,
      });
    }
    await recordAuditEvent(tx, {
      actor,
      action: "ai_connection_key_set",
      entity: "ai_connection",
      entityId: provider,
    });
  });
}

/** Remove the agency's pasted key; the provider falls back to its env var, if any. */
export async function removeAgencyApiKey(
  db: Database,
  actor: Actor,
  provider: ByokProviderId,
): Promise<void> {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.delete(aiConnections).where(agencyScope(provider));
    await recordAuditEvent(tx, {
      actor,
      action: "ai_connection_key_removed",
      entity: "ai_connection",
      entityId: provider,
    });
  });
}

const envKeyOf = (env: ByokApiKeyEnv, provider: ByokProviderId): string | undefined =>
  ({
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    deepseek: env.DEEPSEEK_API_KEY,
  })[provider];

/** The key to actually use: the agency's pasted key if active, else the env var. */
export async function resolveApiKey(
  db: Database,
  env: ByokApiKeyEnv,
  provider: ByokProviderId,
): Promise<string | undefined> {
  if (env.FORGECY_ENCRYPTION_KEY) {
    const [row] = await db
      .select({ encryptedKey: aiConnections.encryptedKey, status: aiConnections.status })
      .from(aiConnections)
      .where(agencyScope(provider));
    if (row && row.status === "active")
      return decryptSecret(row.encryptedKey, env.FORGECY_ENCRYPTION_KEY);
  }
  return envKeyOf(env, provider);
}

/** `env`, with the agency's pasted keys substituted in wherever one is saved and active. */
export async function resolveAiEnv<E extends ByokApiKeyEnv>(db: Database, env: E): Promise<E> {
  const [openai, anthropic, openrouter, deepseek] = await Promise.all(
    byokProviderIds.map((p) => resolveApiKey(db, env, p)),
  );
  return {
    ...env,
    OPENAI_API_KEY: openai,
    ANTHROPIC_API_KEY: anthropic,
    OPENROUTER_API_KEY: openrouter,
    DEEPSEEK_API_KEY: deepseek,
  };
}

export interface ApiKeyTestResult {
  ok: boolean;
  error?: string;
}

/** A single real, minimal call to confirm the key works, before or after saving it. */
export async function testApiKey(
  provider: ByokProviderId,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ApiKeyTestResult> {
  const key = apiKey.trim();
  try {
    const res = await fetchFn(MODEL_LIST_ENDPOINTS[provider], {
      headers: modelListHeaders(provider, key),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string } | string;
    } | null;
    const message = typeof body?.error === "string" ? body.error : body?.error?.message;
    return { ok: false, error: message ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
