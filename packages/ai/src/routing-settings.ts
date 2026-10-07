import { assertCan, ForgecyError, type Actor, type ProviderId } from "@forgecy/core";
import { appSettings, eq, recordAuditEvent, type Database } from "@forgecy/db";
import { z } from "zod";
import { loadAgentConfigs, withAgents } from "./agents";
import type { Routing } from "./gateway";
import { connectedMcpProviders, isMcpImageProvider, type McpEnv } from "./mcp/registry";
import {
  defaultModelFor,
  defaultRoutingFromEnv,
  imageModelFor,
  imageProviderIds,
  imageProviderOrder,
  type AiEnv,
  type ImageProviderId,
} from "./registry";
import type { ModelRef, ProviderSet } from "./types";

/**
 * The Admin's choice of services and models (Settings > AI providers), stored in
 * `app_settings` under `ai.routing`. Anything left empty falls back to the environment
 * (AI_DEFAULT_PROVIDER, IMAGE_PROVIDERS and the default models).
 */
export const textProviderIds = [
  "anthropic",
  "openai",
  "openrouter",
  "deepseek",
  "local",
] as const satisfies readonly ProviderId[];
export type TextProviderId = (typeof textProviderIds)[number];

const SETTINGS_KEY = "ai.routing";
const model = z.string().trim().max(200);

export const aiRoutingSettingsSchema = z.object({
  text: z
    .object({
      provider: z.enum(textProviderIds),
      model: model.default(""),
      fallback: z
        .object({ provider: z.enum(textProviderIds), model: model.default("") })
        .optional(),
    })
    .optional(),
  /** Image providers in order of use; providers left out are never used. */
  images: z
    .array(z.object({ provider: z.enum(imageProviderIds), model: model.default("") }))
    .max(imageProviderIds.length)
    .refine((l) => new Set(l.map((i) => i.provider)).size === l.length, "duplicate provider")
    .optional(),
});
export type AiRoutingSettings = z.infer<typeof aiRoutingSettingsSchema>;

/** Drops image entries naming a provider a previous version supported (e.g. "weave") but this one no longer does. */
function dropUnknownImageProviders(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.images)) return v;
  return {
    ...v,
    images: v.images.filter(
      (i) =>
        i &&
        typeof i === "object" &&
        (imageProviderIds as readonly string[]).includes(
          (i as { provider?: unknown }).provider as string,
        ),
    ),
  };
}

export async function loadAiRoutingSettings(db: Database): Promise<AiRoutingSettings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SETTINGS_KEY));
  // A saved choice naming a provider that was since removed (e.g. "weave") is dropped
  // instead of failing the whole settings row, so the rest of the Admin's choices stick.
  const parsed = aiRoutingSettingsSchema.safeParse(dropUnknownImageProviders(row?.value ?? {}));
  return parsed.success ? parsed.data : {};
}

export async function saveAiRoutingSettings(
  db: Database,
  actor: Actor,
  input: unknown,
): Promise<AiRoutingSettings> {
  assertCan(actor, "ai.providers.manage");
  if (actor.type !== "user")
    throw new ForgecyError("permission_denied", "Agents cannot change AI providers");
  const parsed = aiRoutingSettingsSchema.safeParse(input);
  if (!parsed.success)
    throw new ForgecyError("validation", parsed.error.issues[0]?.message ?? "invalid");
  const value = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value, updatedBy: actor.id })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor.id } });
    await recordAuditEvent(tx, {
      actor,
      action: "ai_routing_changed",
      entity: "ai_provider",
      meta: {
        text: value.text ? `${value.text.provider}:${value.text.model}` : null,
        images: (value.images ?? []).map((i) => i.provider).join(","),
      },
    });
  });
  return value;
}

export type RoutingEnv = AiEnv & McpEnv;

export interface ResolvedRouting {
  routing: Routing;
  /** Every usable image provider in order (the gateway route keeps the first two). */
  images: ModelRef[];
}

/**
 * Routing from the Admin's settings, keeping only providers that are usable now: a key in
 * the environment, or (MCP) a live connection. Unusable choices fall back to the env default.
 */
export function resolveRouting(
  env: RoutingEnv,
  providers: ProviderSet,
  settings: AiRoutingSettings,
  connectedMcp: ReadonlySet<ProviderId> = new Set(),
): ResolvedRouting {
  const routing = defaultRoutingFromEnv(env, providers);
  const textRef = (p: TextProviderId, m: string): ModelRef | undefined =>
    providers.text[p] ? { provider: p, model: m || defaultModelFor(p, env) } : undefined;
  const primary = settings.text && textRef(settings.text.provider, settings.text.model);
  if (primary) {
    const fb = settings.text?.fallback;
    const fallback = fb && textRef(fb.provider, fb.model);
    routing.default = {
      ...routing.default,
      primary,
      ...(fallback && fallback.provider !== primary.provider ? { fallback } : {}),
    };
    if (!fallback) delete routing.default.fallback;
  }

  const usable = (p: ImageProviderId) =>
    isMcpImageProvider(p) ? connectedMcp.has(p) && !!providers.image[p] : !!providers.image[p];
  const chosen: Array<{ provider: ImageProviderId; model: string }> =
    settings.images ?? imageProviderOrder(env).map((p) => ({ provider: p, model: "" }));
  const images = chosen
    .filter((i) => usable(i.provider))
    .map((i) => ({ provider: i.provider, model: i.model || imageModelFor(i.provider, env) }));
  delete routing.image;
  if (images[0])
    routing.image = { primary: images[0], ...(images[1] ? { fallback: images[1] } : {}) };
  return { routing, images };
}

/**
 * Routing read from the database, cached for `cacheMs` so a busy worker does not query
 * on every call; Admin changes apply within that delay without a restart.
 */
export function createRoutingSource(
  db: Database,
  env: RoutingEnv,
  providers: ProviderSet,
  cacheMs = 15_000,
): () => Promise<ResolvedRouting> {
  let cached: { at: number; value: Promise<ResolvedRouting> } | undefined;
  return () => {
    const now = Date.now();
    if (!cached || now - cached.at > cacheMs) {
      const value = (async () => {
        const [settings, connected, agents] = await Promise.all([
          loadAiRoutingSettings(db),
          env.FORGECY_ENCRYPTION_KEY
            ? connectedMcpProviders(db)
            : Promise.resolve(new Set<ProviderId>()),
          loadAgentConfigs(db),
        ]);
        const resolved = resolveRouting(env, providers, settings, connected);
        // Agent configuration (switched off, model per task, instructions) on top.
        return { ...resolved, routing: withAgents(resolved.routing, agents, providers, env) };
      })();
      cached = { at: now, value };
      value.catch(() => {
        cached = undefined;
      });
    }
    return cached.value;
  };
}

/** `GatewayOptions.routing` that follows the Admin's settings (see `createRoutingSource`). */
export function settingsRouting(
  db: Database,
  env: RoutingEnv,
  providers: ProviderSet,
): () => Promise<Routing> {
  const source = createRoutingSource(db, env, providers);
  return async () => (await source()).routing;
}
