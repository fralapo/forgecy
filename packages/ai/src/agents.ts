/**
 * Agent configuration (v1, spec pages 54–55), read by the gateway through the routing:
 * an agent switched off is refused, its tasks may use their own model, and its published
 * instructions are added to the system prompt. Only Admins change it (`agents.configure`).
 */
import {
  AGENT_INSTRUCTIONS_MAX,
  agentRoles,
  agentTaskRouteSchema,
  assertCan,
  PermissionDeniedError,
  type Actor,
  type AgentRole,
  type AgentTaskRoute,
} from "@forgecy/core";
import {
  agentInstructions,
  agentSettings,
  and,
  clients,
  desc,
  eq,
  jobs,
  jobsLog,
  recordAuditEvent,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { z } from "zod";
import { AGENT_TASKS, agentRunKinds, type AgentRuntime } from "./agent-tasks";
import type { Routing, TaskRoute } from "./gateway";
import { defaultModelFor, type AiEnv } from "./registry";
import type { AiTask, ProviderSet } from "./types";

export type AgentInstructionVersion = typeof agentInstructions.$inferSelect;

export interface AgentConfig {
  agent: AgentRole;
  active: boolean;
  routes: Partial<Record<AiTask, AgentTaskRoute>>;
  /** Newest published version (its text may be empty: instructions removed). */
  published: AgentInstructionVersion | null;
  draft: AgentInstructionVersion | null;
  /** Every version, newest first. */
  history: AgentInstructionVersion[];
  updatedAt: Date | null;
}

export async function loadAgentConfigs(
  db: Pick<Database, "select">,
): Promise<Record<AgentRole, AgentConfig>> {
  const [settings, versions] = await Promise.all([
    db.select().from(agentSettings),
    db.select().from(agentInstructions).orderBy(desc(agentInstructions.version)),
  ]);
  const out = {} as Record<AgentRole, AgentConfig>;
  for (const agent of agentRoles) {
    const s = settings.find((r) => r.agent === agent);
    const history = versions.filter((v) => v.agent === agent);
    out[agent] = {
      agent,
      active: s?.active ?? true,
      routes: (s?.routes ?? {}) as AgentConfig["routes"],
      published: history.find((v) => v.status === "published") ?? null,
      draft: history.find((v) => v.status === "draft") ?? null,
      history,
      updatedAt: s?.updatedAt ?? null,
    };
  }
  return out;
}

/**
 * Adds the agents to a resolved routing. A task model whose service has no key is
 * ignored (the AI settings apply), so a half-configured choice never stops work.
 */
export function withAgents(
  routing: Routing,
  configs: Record<AgentRole, AgentConfig>,
  providers: ProviderSet,
  env: Pick<AiEnv, "LOCAL_LLM_MODEL">,
): Routing {
  const agents: Partial<Record<AgentRole, AgentRuntime>> = {};
  for (const agent of agentRoles) {
    const c = configs[agent];
    const tasks: Partial<Record<AiTask, TaskRoute>> = {};
    for (const [task, r] of Object.entries(c.routes) as [AiTask, AgentTaskRoute][]) {
      const provider = r.provider as keyof ProviderSet["text"];
      if (!providers.text[provider] || !AGENT_TASKS[agent].includes(task)) continue;
      const base = routing.tasks?.[task] ?? routing.default;
      const route: TaskRoute = {
        ...base,
        primary: { provider, model: r.model || defaultModelFor(provider, env) },
      };
      if (!base.fallback || base.fallback.provider === provider) delete route.fallback;
      tasks[task] = route;
    }
    agents[agent] = {
      active: c.active,
      ...(c.published?.text.trim()
        ? { instructions: { version: c.published.version, text: c.published.text } }
        : {}),
      ...(Object.keys(tasks).length ? { tasks } : {}),
    };
  }
  return { ...routing, agents };
}

function admin(actor: Actor): Extract<Actor, { type: "user" }> {
  // An agent never changes its own configuration (spec page 55).
  if (actor.type !== "user") throw new PermissionDeniedError("agents.configure", actor);
  assertCan(actor, "agents.configure");
  return actor;
}

async function upsertSettings(
  db: Pick<Database, "insert">,
  agent: AgentRole,
  userId: string,
  set: { active?: boolean; routes?: Record<string, AgentTaskRoute> },
) {
  await db
    .insert(agentSettings)
    .values({ agent, updatedBy: userId, ...set })
    .onConflictDoUpdate({ target: agentSettings.agent, set: { ...set, updatedBy: userId } });
}

/**
 * “Deactivate agent” / “Activate agent”. Switching off needs the agent's key typed:
 * every function that uses it stops for every client until it is switched on again.
 */
export async function setAgentActive(
  db: Database,
  actor: Actor,
  agent: AgentRole,
  active: boolean,
  confirmKey?: string,
): Promise<void> {
  const user = admin(actor);
  if (!active && confirmKey?.trim() !== agent)
    throw localizedError("validation", "agents.errors.typedKeyMismatch", { key: agent });
  await db.transaction(async (tx) => {
    await upsertSettings(tx, agent, user.id, { active });
    await recordAuditEvent(tx, {
      actor: user,
      action: active ? "agent.activated" : "agent.deactivated",
      entity: "agent",
      entityId: agent,
    });
  });
}

const routesSchema = z.record(z.string(), agentTaskRouteSchema);

/** “Tasks and models”: the model of each task; a task left out follows the AI settings. */
export async function saveAgentRoutes(
  db: Database,
  actor: Actor,
  agent: AgentRole,
  input: unknown,
): Promise<void> {
  const user = admin(actor);
  const parsed = routesSchema.safeParse(input);
  if (!parsed.success) throw localizedError("validation", "agents.errors.invalidRoutes");
  const routes: Record<string, AgentTaskRoute> = {};
  for (const [task, r] of Object.entries(parsed.data)) {
    if (!(AGENT_TASKS[agent] as readonly string[]).includes(task))
      throw localizedError("validation", "agents.errors.invalidRoutes");
    if (r.provider !== "default") routes[task] = r;
  }
  await db.transaction(async (tx) => {
    await upsertSettings(tx, agent, user.id, { routes });
    await recordAuditEvent(tx, {
      actor: user,
      action: "agent.routes_changed",
      entity: "agent",
      entityId: agent,
      meta: { routes },
    });
  });
}

const textSchema = z.string().max(AGENT_INSTRUCTIONS_MAX);

/** Saves the draft of the next instructions version (creates it when there is none). */
export async function saveAgentInstructionsDraft(
  db: Database,
  actor: Actor,
  agent: AgentRole,
  text: string,
): Promise<AgentInstructionVersion> {
  const user = admin(actor);
  const parsed = textSchema.safeParse(text);
  if (!parsed.success)
    throw localizedError("validation", "agents.errors.tooLong", { max: AGENT_INSTRUCTIONS_MAX });
  return db.transaction(async (tx) => {
    const [draft] = await tx
      .update(agentInstructions)
      .set({ text: parsed.data })
      .where(and(eq(agentInstructions.agent, agent), eq(agentInstructions.status, "draft")))
      .returning();
    if (draft) return draft;
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${agentInstructions.version}), 0)::int` })
      .from(agentInstructions)
      .where(eq(agentInstructions.agent, agent));
    const [row] = await tx
      .insert(agentInstructions)
      .values({ agent, version: (last?.n ?? 0) + 1, text: parsed.data, createdBy: user.id })
      .returning();
    return row!;
  });
}

/** “Publish version”: the draft becomes the version every new run uses; changelog required. */
export async function publishAgentInstructions(
  db: Database,
  actor: Actor,
  agent: AgentRole,
  changelog: string,
): Promise<AgentInstructionVersion> {
  const user = admin(actor);
  const note = changelog.trim();
  if (note.length < 3 || note.length > 500)
    throw localizedError("validation", "agents.errors.changelogRequired");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(agentInstructions)
      .set({ status: "published", changelog: note, publishedBy: user.id, publishedAt: new Date() })
      .where(and(eq(agentInstructions.agent, agent), eq(agentInstructions.status, "draft")))
      .returning();
    if (!row) throw localizedError("conflict", "agents.errors.noDraft");
    await recordAuditEvent(tx, {
      actor: user,
      action: "agent.instructions_published",
      entity: "agent",
      entityId: agent,
      meta: { version: row.version, changelog: note },
    });
    return row;
  });
}

export async function discardAgentInstructionsDraft(
  db: Database,
  actor: Actor,
  agent: AgentRole,
): Promise<void> {
  admin(actor);
  await db
    .delete(agentInstructions)
    .where(and(eq(agentInstructions.agent, agent), eq(agentInstructions.status, "draft")));
}

/**
 * The agent of a `jobs_log` row: the one the gateway recorded, or for older rows the
 * agent that owns the task.
 */
export function runAgentSql() {
  const cases = agentRoles.flatMap((a) => agentRunKinds(a).map((k) => sql`when ${k} then ${a}`));
  return sql<
    string | null
  >`coalesce(${jobsLog.inputSummary} #>> '{agent,key}', case ${jobsLog.kind} ${sql.join(cases, sql` `)} end)`;
}

export interface AgentRunStats {
  /** Runs in the last 30 days, and how many of them failed. */
  runs: number;
  failed: number;
  /** Cost of this calendar month. */
  monthCostMicroUsd: number;
}

/** Runs, failures and cost per agent; every user can read them (spec page 54). */
export async function agentRunStats(
  db: Pick<Database, "execute">,
  now = new Date(),
): Promise<Record<AgentRole, AgentRunStats>> {
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const res = await db.execute<{ agent: string; runs: number; failed: number; cost: number }>(sql`
    select agent,
      count(*) filter (where started_at >= ${since.toISOString()})::int as runs,
      count(*) filter (where started_at >= ${since.toISOString()} and status = 'error')::int as failed,
      coalesce(sum(cost_micro_usd) filter (where started_at >= ${month.toISOString()}), 0)::int as cost
    from (select ${runAgentSql()} as agent, started_at, status, cost_micro_usd from ${jobsLog}
          where started_at >= ${(since < month ? since : month).toISOString()}) r
    where agent is not null
    group by agent`);
  const out = {} as Record<AgentRole, AgentRunStats>;
  for (const a of agentRoles) {
    const r = res.rows.find((x) => x.agent === a);
    out[a] = { runs: r?.runs ?? 0, failed: r?.failed ?? 0, monthCostMicroUsd: r?.cost ?? 0 };
  }
  return out;
}

export interface AgentRunRow {
  id: string;
  kind: string;
  status: "ok" | "error" | "blocked";
  provider: string | null;
  model: string | null;
  costMicroUsd: number;
  startedAt: Date;
  endedAt: Date | null;
  clientName: string | null;
  startedBy: string | null;
  instructionsVersion: number | null;
}

/** The latest runs of one agent (spec page 55, tab Runs). */
export async function listAgentRuns(
  db: Pick<Database, "select">,
  agent: AgentRole,
  limit = 50,
): Promise<AgentRunRow[]> {
  const rows = await db
    .select({
      id: jobsLog.id,
      kind: jobsLog.kind,
      status: jobsLog.status,
      provider: jobsLog.provider,
      model: jobsLog.model,
      costMicroUsd: jobsLog.costMicroUsd,
      startedAt: jobsLog.startedAt,
      endedAt: jobsLog.endedAt,
      clientName: clients.name,
      startedBy: users.name,
      instructionsVersion: sql<
        number | null
      >`(${jobsLog.inputSummary} #>> '{agent,instructionsVersion}')::int`,
    })
    .from(jobsLog)
    .leftJoin(clients, eq(clients.id, jobsLog.clientId))
    .leftJoin(users, eq(users.id, jobsLog.authorizedBy))
    .where(sql`${runAgentSql()} = ${agent}`)
    .orderBy(desc(jobsLog.startedAt))
    .limit(limit);
  return rows;
}

export interface AgentRunDetail {
  run: typeof jobsLog.$inferSelect;
  agent: AgentRole | null;
  clientName: string | null;
  clientSlug: string | null;
  startedBy: string | null;
  job: { id: string; kind: string; status: string; entity: string | null } | null;
  /** Every `jobs_log` row of the same job and task: attempts, fallbacks, retries. */
  attempts: Array<
    Pick<
      typeof jobsLog.$inferSelect,
      "id" | "status" | "provider" | "model" | "startedAt" | "error"
    >
  >;
}

/** One run, for its details page (spec page 57); every user can read it. */
export async function getAgentRun(
  db: Pick<Database, "select">,
  id: string,
): Promise<AgentRunDetail | null> {
  const [row] = await db
    .select({
      run: jobsLog,
      agent: runAgentSql(),
      clientName: clients.name,
      clientSlug: clients.slug,
      startedBy: users.name,
      jobKind: jobs.kind,
      jobStatus: jobs.status,
      jobEntity: jobs.entity,
    })
    .from(jobsLog)
    .leftJoin(clients, eq(clients.id, jobsLog.clientId))
    .leftJoin(users, eq(users.id, jobsLog.authorizedBy))
    .leftJoin(jobs, eq(jobs.id, jobsLog.jobId))
    .where(eq(jobsLog.id, id))
    .limit(1);
  if (!row) return null;
  const attempts = row.run.jobId
    ? await db
        .select({
          id: jobsLog.id,
          status: jobsLog.status,
          provider: jobsLog.provider,
          model: jobsLog.model,
          startedAt: jobsLog.startedAt,
          error: jobsLog.error,
        })
        .from(jobsLog)
        .where(and(eq(jobsLog.jobId, row.run.jobId), eq(jobsLog.kind, row.run.kind)))
        .orderBy(jobsLog.startedAt)
        .limit(50)
    : [];
  const agent = (agentRoles as readonly string[]).includes(row.agent ?? "")
    ? (row.agent as AgentRole)
    : null;
  return {
    run: row.run,
    agent,
    clientName: row.clientName,
    clientSlug: row.clientSlug,
    startedBy: row.startedBy,
    job:
      row.run.jobId && row.jobKind
        ? {
            id: row.run.jobId,
            kind: row.jobKind,
            status: row.jobStatus ?? "",
            entity: row.jobEntity,
          }
        : null,
    attempts,
  };
}
