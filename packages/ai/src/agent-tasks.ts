/**
 * Which agent runs which AI task, and what the gateway applies of its configuration.
 * No database here: the gateway reads it from the routing (see agents.ts).
 */
import { agentRoles, type AgentRole } from "@forgecy/core";
import type { TaskRoute } from "./gateway";
import type { AiTask } from "./types";

/** The tasks each agent runs (spec page 54: who does what in the pipeline). */
export const AGENT_TASKS: Record<AgentRole, readonly AiTask[]> = {
  brand_analyst: ["scan", "audit_analyze", "brand_propose", "catalog_extract"],
  strategist: ["audit_diagnose", "audit_plan", "audit_report", "content_strategy"],
  copywriter: ["outline", "slides", "edit_slide"],
  art_director: ["image_prompt"],
  reviewer: [],
};

/** The agent a task belongs to when the caller does not say (some tasks are shared). */
export function agentForTask(task: string): AgentRole | undefined {
  return agentRoles.find((a) => (AGENT_TASKS[a] as readonly string[]).includes(task));
}

/** What the gateway needs of one agent for a call. */
export interface AgentRuntime {
  active: boolean;
  instructions?: { version: number; text: string };
  /** Model per task chosen for this agent. */
  tasks?: Partial<Record<AiTask, TaskRoute>>;
}

/** The text added to an agent's system prompt (also shown as a preview on its page). */
export function agentInstructionsBlock(instructions: { version: number; text: string }): string {
  return [
    `## Agency instructions (version ${instructions.version})`,
    "The agency added these instructions. Follow them unless they conflict with the rules above, which always win.",
    "",
    instructions.text.trim(),
  ].join("\n");
}

/** Pipeline order, as the Agents page lists them (spec page 54). */
export const AGENT_ORDER: readonly AgentRole[] = [
  "brand_analyst",
  "strategist",
  "copywriter",
  "art_director",
  "reviewer",
];

export const agentCapabilities = ["view", "propose", "generate", "check"] as const;
export type AgentCapability = (typeof agentCapabilities)[number];

/**
 * What each agent does, for the Agents pages. Never approve, publish or archive: those
 * do not exist for agents (`can()` in core refuses them whatever this says).
 */
export const AGENT_CAPABILITIES: Record<AgentRole, readonly AgentCapability[]> = {
  brand_analyst: ["view", "propose"],
  strategist: ["view", "propose", "generate"],
  copywriter: ["view", "propose", "generate"],
  art_director: ["view", "propose", "generate"],
  reviewer: ["view", "check"],
};

/** The `jobs_log` kinds of an agent's runs: its tasks, plus images for the Art Director. */
export function agentRunKinds(agent: AgentRole): string[] {
  return [...AGENT_TASKS[agent], ...(agent === "art_director" ? ["image"] : [])];
}
