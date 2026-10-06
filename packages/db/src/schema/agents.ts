/**
 * Agent configuration (v1, spec pages 54–55). One settings row per agent that an Admin
 * changed (no row = active, models from Settings › AI providers), and the versions of the
 * instructions added to its prompt: at most one draft, published versions never change.
 */
import { agentInstructionStatuses, agentRoles, type AgentTaskRoute } from "@forgecy/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id, updatedAt } from "./_common";

export const agentKeyEnum = pgEnum("agent_key", agentRoles);
export const agentInstructionStatusEnum = pgEnum(
  "agent_instruction_status",
  agentInstructionStatuses,
);

export const agentSettings = pgTable("agent_settings", {
  agent: agentKeyEnum("agent").primaryKey(),
  active: boolean("active").notNull().default(true),
  /** Model per task (`AiTask` → service and model); tasks left out follow the AI settings. */
  routes: jsonb("routes").$type<Record<string, AgentTaskRoute>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export const agentInstructions = pgTable(
  "agent_instructions",
  {
    id: id(),
    agent: agentKeyEnum("agent").notNull(),
    version: integer("version").notNull(),
    text: text("text").notNull(),
    /** Required to publish: what changed and why. */
    changelog: text("changelog"),
    status: agentInstructionStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agent_instructions_version_uq").on(t.agent, t.version),
    uniqueIndex("agent_instructions_one_draft_uq")
      .on(t.agent)
      .where(sql`${t.status} = 'draft'`),
  ],
);
