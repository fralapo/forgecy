import "server-only";
import {
  createAiGateway,
  createDbLedger,
  createMcpImageProviders,
  loadAgentConfigs,
  resolveAiEnv,
  withAgents,
  type AiGateway,
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

/** Call after saving or removing a pasted API key so the next call picks it up. */
export function resetProviders(): void {
  providers = undefined;
}

/** Providers configured on this install (env vars, pasted keys, MCP adapters); cached until reset. */
export async function getProviders(): Promise<ProviderSet> {
  if (!providers) {
    const db = getDb();
    const set = createProvidersFromEnv(await resolveAiEnv(db, env));
    set.image = { ...set.image, ...createMcpImageProviders(db, env) };
    providers = set;
  }
  return providers;
}

/** The routing the worker will use now: the Admin's choices, limited to usable providers. */
export async function currentRouting(): Promise<ResolvedRouting> {
  const db = getDb();
  const [settings, connected, resolvedProviders] = await Promise.all([
    loadAiRoutingSettings(db),
    env.FORGECY_ENCRYPTION_KEY ? connectedMcpProviders(db) : Promise.resolve(new Set<never>()),
    getProviders(),
  ]);
  return resolveRouting(env, resolvedProviders, settings, connected);
}

/**
 * A gateway for the few AI calls the web app makes itself (“Try on an example”): same
 * policy, budget, log and agent configuration as the worker.
 */
export async function webGateway(): Promise<AiGateway> {
  const db = getDb();
  return createAiGateway({
    ledger: createDbLedger(db),
    providers: await getProviders(),
    routing: async () => {
      const [resolved, configs] = await Promise.all([currentRouting(), loadAgentConfigs(db)]);
      return withAgents(resolved.routing, configs, await getProviders(), env);
    },
  });
}
