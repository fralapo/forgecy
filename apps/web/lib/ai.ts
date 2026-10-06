import "server-only";
import {
  createMcpImageProviders,
  createProvidersFromEnv,
  loadAiRoutingSettings,
  resolveRouting,
  connectedMcpProviders,
  type ProviderSet,
  type ResolvedRouting,
} from "@forgecy/ai";
import { getDb } from "@forgecy/db";
import { env } from "./env";

let providers: ProviderSet | undefined;

/** Providers configured on this install (keys in .env, MCP adapters); built once. */
export function getProviders(): ProviderSet {
  if (!providers) {
    const set = createProvidersFromEnv(env);
    set.image = { ...set.image, ...createMcpImageProviders(getDb(), env) };
    providers = set;
  }
  return providers;
}

/** The routing the worker will use now: the Admin's choices, limited to usable providers. */
export async function currentRouting(): Promise<ResolvedRouting> {
  const db = getDb();
  const [settings, connected] = await Promise.all([
    loadAiRoutingSettings(db),
    env.FORGECY_ENCRYPTION_KEY ? connectedMcpProviders(db) : Promise.resolve(new Set<never>()),
  ]);
  return resolveRouting(env, getProviders(), settings, connected);
}
