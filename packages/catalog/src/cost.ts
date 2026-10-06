import {
  computeCost,
  createDbLedger,
  createProvidersFromEnv,
  defaultRoutingFromEnv,
  monthKey,
  type AiEnv,
} from "@forgecy/ai";
import type { AiPolicy } from "@forgecy/core";
import type { Database } from "@forgecy/db";
import { estimateTokens } from "./ai";
import type { plannedAiSteps } from "./imports";
import { aiAvailability } from "./sniff";

export type PlannedAi = ReturnType<typeof plannedAiSteps>;

export interface AiSetup {
  /** False when the policy, or the missing configuration, rules AI out. */
  available: boolean;
  reason?: string;
  provider?: string;
  model?: string;
}

/** Which model an import would use for this client, or why none. */
export function importAiSetup(env: AiEnv, policy: AiPolicy): AiSetup {
  const avail = aiAvailability(policy, env.LOCAL_LLM_ENABLED);
  if (!avail.available) return { available: false, reason: avail.reason };
  if (policy === "local_only") {
    const routing = defaultRoutingFromEnv(env);
    return { available: true, provider: "local", model: routing.local?.model };
  }
  const providers = createProvidersFromEnv(env);
  if (Object.keys(providers.text).length === 0)
    return {
      available: false,
      reason:
        "Nessun provider AI configurato: l'import usa mappatura manuale, abbinamento per nome file e SKU e PDF come fonte.",
    };
  const route = defaultRoutingFromEnv(env, providers);
  const ref = route.tasks?.catalog_extract?.primary ?? route.default.primary;
  return { available: true, provider: ref.provider, model: ref.model };
}

/** Rough cost of the AI steps, in USD: an estimate shown before starting, never a promise. */
export function estimateImportCostUsd(setup: AiSetup, planned: PlannedAi): number {
  if (!setup.available || !planned.usesAi || !setup.provider || !setup.model) return 0;
  const pdf = estimateTokens(planned.pdfChars);
  const images = estimateTokens(planned.images * 120);
  const sheets = estimateTokens(planned.sheets * 2000);
  const usage = {
    inputTokens:
      (planned.pdfChars ? pdf.input : 0) +
      (planned.images ? images.input : 0) +
      (planned.sheets ? sheets.input : 0),
    outputTokens:
      (planned.pdfChars ? pdf.output : 0) +
      (planned.images ? images.output : 0) +
      (planned.sheets ? sheets.output : 0),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const { costMicroUsd } = computeCost(setup.provider as never, setup.model, usage);
  return costMicroUsd / 1_000_000;
}

export interface BudgetState {
  /** Percent of the client's monthly budget already used, or null without a budget. */
  percent: number | null;
  spentUsd: number;
  limitUsd: number | null;
}

/** The client's monthly AI budget, for the 70/90/100 thresholds. */
export async function clientBudget(db: Database, clientId: string): Promise<BudgetState> {
  const ledger = createDbLedger(db);
  const month = monthKey();
  const scope = { scope: "client" as const, clientId };
  const [limit, spent] = await Promise.all([
    ledger.budgetFor(scope, month),
    ledger.monthSpendMicroUsd(scope, month),
  ]);
  if (!limit) return { percent: null, spentUsd: spent / 1_000_000, limitUsd: null };
  return {
    percent: limit.limitMicroUsd > 0 ? Math.round((spent / limit.limitMicroUsd) * 100) : 100,
    spentUsd: spent / 1_000_000,
    limitUsd: limit.limitMicroUsd / 1_000_000,
  };
}
