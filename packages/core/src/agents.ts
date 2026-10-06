/**
 * Agent configuration (v1, spec pages 54–55): Admins switch an agent off, pick the model
 * of each of its tasks, and publish versioned instructions that are added to its prompt.
 * Agents never change their own configuration and never approve anything.
 */
import { z } from "zod";
import { agentRoles } from "./permissions";

export const agentInstructionStatuses = ["draft", "published"] as const;
export type AgentInstructionStatus = (typeof agentInstructionStatuses)[number];

/** Longest instructions an Admin can add to an agent's prompt. */
export const AGENT_INSTRUCTIONS_MAX = 4000;

export const agentKeySchema = z.enum(agentRoles);

/** Model chosen for one task of an agent; empty model = the service's default. */
export const agentTaskRouteSchema = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().trim().max(200).default(""),
});
export type AgentTaskRoute = z.infer<typeof agentTaskRouteSchema>;
