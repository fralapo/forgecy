/**
 * “Try on an example” (spec page 55, Admin only): runs one of the agent's tasks on an
 * example the Admin writes, with the draft instructions in place of the published ones.
 * No client data: no client, no memories, the agency's default policy. The run is
 * logged and costed like any other.
 */
import {
  AGENT_INSTRUCTIONS_MAX,
  assertCan,
  PermissionDeniedError,
  type Actor,
  type AgentRole,
} from "@forgecy/core";
import type { Database } from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { z } from "zod";
import { AGENT_TASKS } from "./agent-tasks";
import type { AiGateway } from "./gateway";
import { computeCost } from "./pricing";
import { getDefaultAiPolicy } from "./settings";
import type { AiTask, ModelRef } from "./types";

export const PREVIEW_EXAMPLE_MAX = 4000;
/** Tokens assumed for the cost shown before a try (system, instructions, example, answer). */
const ESTIMATE = { inputTokens: 2500, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function estimatePreviewCostMicroUsd(model: ModelRef | undefined): number | null {
  if (!model) return null;
  const c = computeCost(model.provider, model.model, ESTIMATE);
  return c.priced ? c.costMicroUsd : null;
}

const previewSchema = z.object({
  output: z.string().max(8000),
  followed: z.array(z.string().max(300)).max(10),
});

export interface AgentPreviewResult {
  output: string;
  followed: string[];
  provider: string;
  model: string;
  costMicroUsd: number;
}

export async function previewAgentInstructions(
  deps: { db: Pick<Database, "select">; gateway: AiGateway },
  actor: Actor,
  agent: AgentRole,
  input: { task: string; example: string; text: string; version: number },
): Promise<AgentPreviewResult> {
  if (actor.type !== "user") throw new PermissionDeniedError("agents.configure", actor);
  assertCan(actor, "agents.configure");
  const task = (AGENT_TASKS[agent] as readonly string[]).find((x) => x === input.task) as
    AiTask | undefined;
  if (!task) throw localizedError("validation", "agents.preview.errors.task");
  const example = input.example.trim();
  if (example.length < 3 || example.length > PREVIEW_EXAMPLE_MAX)
    throw localizedError("validation", "agents.preview.errors.example", {
      max: PREVIEW_EXAMPLE_MAX,
    });
  if (input.text.length > AGENT_INSTRUCTIONS_MAX)
    throw localizedError("validation", "agents.errors.tooLong", { max: AGENT_INSTRUCTIONS_MAX });
  const { policy } = await getDefaultAiPolicy(deps.db);
  if (policy === "no_ai") throw localizedError("policy_blocked", "agents.preview.errors.noAi");

  const res = await deps.gateway.generateObject({
    task,
    agent,
    schema: previewSchema,
    schemaName: "agent_preview",
    system: [
      `You are the ${agent} agent of Forgecy, a marketing agency tool, running the "${task}" task.`,
      "An administrator is testing new agency instructions on an EXAMPLE they wrote: there is no client and no client data.",
      'Put in "output" what you would produce for this example, as plain text.',
      'List in "followed" (at most 10 short points) how the agency instructions shaped the output.',
    ].join("\n"),
    input: example,
    instructions: { version: input.version, text: input.text },
    clientPolicy: policy,
    authorizedBy: actor.id,
    inputSummary: { meta: { preview: true } },
  });
  return {
    output: res.data.output,
    followed: res.data.followed,
    provider: res.provider,
    model: res.model,
    costMicroUsd: res.costMicroUsd,
  };
}
