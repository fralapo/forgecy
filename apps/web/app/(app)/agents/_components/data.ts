import "server-only";
import {
  AGENT_TASKS,
  agentRunStats,
  defaultModelFor,
  loadAgentConfigs,
  textProviderIds,
  withAgents,
  type AiTask,
  type ModelRef,
  type TextProviderId,
} from "@forgecy/ai";
import type { AgentRole } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { currentRouting, getProviders } from "@/lib/ai";
import { env } from "@/lib/env";

/** Service names are brands; the local model gets its translated name on the page. */
const textNames: Record<TextProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  local: "",
};

const textReady: Record<TextProviderId, boolean> = {
  anthropic: Boolean(env.ANTHROPIC_API_KEY),
  openai: Boolean(env.OPENAI_API_KEY),
  openrouter: Boolean(env.OPENROUTER_API_KEY),
  deepseek: Boolean(env.DEEPSEEK_API_KEY),
  local: env.LOCAL_LLM_ENABLED,
};

export interface TaskModel {
  task: AiTask | "image";
  primary: ModelRef | undefined;
  fallback: ModelRef | undefined;
  /** Chosen on the agent's page rather than in the AI settings. */
  fromAgent: boolean;
}

/** Everything the Agents pages show: configuration, statistics, model in use per task. */
export async function loadAgentsView(localName: string) {
  const db = getDb();
  const [configs, stats, resolved] = await Promise.all([
    loadAgentConfigs(db),
    agentRunStats(db),
    currentRouting(),
  ]);
  const routing = withAgents(resolved.routing, configs, getProviders(), env);
  const taskModels = (agent: AgentRole): TaskModel[] => {
    const rows: TaskModel[] = AGENT_TASKS[agent].map((task) => {
      const own = routing.agents?.[agent]?.tasks?.[task];
      const route = own ?? routing.tasks?.[task] ?? routing.default;
      return { task, primary: route.primary, fallback: route.fallback, fromAgent: !!own };
    });
    if (agent === "art_director")
      rows.push({
        task: "image",
        primary: resolved.images[0],
        fallback: resolved.images[1],
        fromAgent: false,
      });
    return rows;
  };
  const providers = textProviderIds.map((id) => ({
    id,
    name: id === "local" ? localName : textNames[id],
    ready: textReady[id],
    defaultModel: defaultModelFor(id, env),
  }));
  return { configs, stats, taskModels, providers };
}

export const modelLabel = (m: ModelRef | undefined) => (m ? `${m.provider} · ${m.model}` : "");
