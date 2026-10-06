/**
 * Agent memory (spec page 56). Agents only write `observed` notes and `candidate`
 * proposals; a person approves, rejects (with a reason), edits (a new version) or
 * archives. The gateway adds a client's approved memories to the agent's prompt and
 * records their ids in the run (`input_summary.memory`).
 */
import {
  assertCan,
  isSensitiveMemoryCategory,
  memoryCategories,
  memoryConfidences,
  memoryContentSchema,
  memorySettingKeys,
  memorySettingSchemas,
  MEMORY_PROMPT_LIMIT,
  PermissionDeniedError,
  type Actor,
  type AgentRole,
  type MemoryCategory,
  type MemoryConfidence,
  type MemorySettingKey,
  type MemorySettingValues,
  type MemoryStatus,
} from "@forgecy/core";
import {
  and,
  clientMemorySettings,
  clients,
  desc,
  eq,
  inArray,
  jobsLog,
  memoryItems,
  memoryItemVersions,
  ne,
  recordAuditEvent,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { localizedError } from "@forgecy/i18n";
import { z } from "zod";

export type MemoryItem = typeof memoryItems.$inferSelect;

export interface MemoryRow extends MemoryItem {
  clientName: string;
  clientSlug: string;
  createdByName: string | null;
  decidedByName: string | null;
}

/** `default` hides observed notes (spec: visible only with the “All” filter). */
export type MemoryStatusFilter = MemoryStatus | "default" | "all";

export interface MemoryFilter {
  agent?: AgentRole;
  clientId?: string;
  status?: MemoryStatusFilter;
  limit?: number;
}

const decider = sql<
  string | null
>`(select name from users d where d.id = ${memoryItems.decidedBy})`;

export async function listMemories(
  db: Pick<Database, "select">,
  filter: MemoryFilter = {},
): Promise<MemoryRow[]> {
  const where = [];
  if (filter.agent) where.push(eq(memoryItems.agent, filter.agent));
  if (filter.clientId) where.push(eq(memoryItems.clientId, filter.clientId));
  const status = filter.status ?? "default";
  if (status === "default") where.push(ne(memoryItems.status, "observed"));
  else if (status !== "all") where.push(eq(memoryItems.status, status));
  const rows = await db
    .select({
      item: memoryItems,
      clientName: clients.name,
      clientSlug: clients.slug,
      createdByName: users.name,
      decidedByName: decider,
    })
    .from(memoryItems)
    .innerJoin(clients, eq(clients.id, memoryItems.clientId))
    .leftJoin(users, eq(users.id, memoryItems.createdBy))
    .where(where.length ? and(...where) : undefined)
    // Candidates first (they wait for a decision), then newest.
    .orderBy(
      sql`case ${memoryItems.status} when 'candidate' then 0 when 'approved' then 1 else 2 end`,
      desc(memoryItems.updatedAt),
    )
    .limit(filter.limit ?? 200);
  return rows.map((r) => ({
    ...r.item,
    clientName: r.clientName,
    clientSlug: r.clientSlug,
    createdByName: r.createdByName,
    decidedByName: r.decidedByName,
  }));
}

/** Counters of the page header: candidates to decide and approved memories. */
export async function memoryCounts(
  db: Pick<Database, "select">,
  filter: Pick<MemoryFilter, "agent" | "clientId"> = {},
): Promise<{ candidate: number; approved: number }> {
  const where = [inArray(memoryItems.status, ["candidate", "approved"])];
  if (filter.agent) where.push(eq(memoryItems.agent, filter.agent));
  if (filter.clientId) where.push(eq(memoryItems.clientId, filter.clientId));
  const rows = await db
    .select({ status: memoryItems.status, n: sql<number>`count(*)::int` })
    .from(memoryItems)
    .where(and(...where))
    .groupBy(memoryItems.status);
  const n = (s: MemoryStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return { candidate: n("candidate"), approved: n("approved") };
}

export interface MemoryDetail {
  item: MemoryRow;
  versions: Array<{
    version: number;
    content: string;
    category: MemoryCategory;
    authorName: string | null;
    authorAgent: AgentRole | null;
    createdAt: Date;
  }>;
  /** Last 10 runs that had this memory in their prompt. */
  usedIn: Array<{ id: string; kind: string; status: string; startedAt: Date }>;
}

export async function getMemory(
  db: Pick<Database, "select">,
  id: string,
): Promise<MemoryDetail | null> {
  const [row] = await db
    .select({
      item: memoryItems,
      clientName: clients.name,
      clientSlug: clients.slug,
      createdByName: users.name,
      decidedByName: decider,
    })
    .from(memoryItems)
    .innerJoin(clients, eq(clients.id, memoryItems.clientId))
    .leftJoin(users, eq(users.id, memoryItems.createdBy))
    .where(eq(memoryItems.id, id));
  if (!row) return null;
  const [versions, usedIn] = await Promise.all([
    db
      .select({
        version: memoryItemVersions.version,
        content: memoryItemVersions.content,
        category: memoryItemVersions.category,
        authorName: users.name,
        authorAgent: memoryItemVersions.authorAgent,
        createdAt: memoryItemVersions.createdAt,
      })
      .from(memoryItemVersions)
      .leftJoin(users, eq(users.id, memoryItemVersions.authorId))
      .where(eq(memoryItemVersions.memoryId, id))
      .orderBy(desc(memoryItemVersions.version)),
    db
      .select({
        id: jobsLog.id,
        kind: jobsLog.kind,
        status: jobsLog.status,
        startedAt: jobsLog.startedAt,
      })
      .from(jobsLog)
      .where(
        and(
          eq(jobsLog.clientId, row.item.clientId),
          sql`${jobsLog.inputSummary} -> 'memory' @> ${JSON.stringify([{ id }])}::jsonb`,
        ),
      )
      .orderBy(desc(jobsLog.startedAt))
      .limit(10),
  ]);
  return {
    item: {
      ...row.item,
      clientName: row.clientName,
      clientSlug: row.clientSlug,
      createdByName: row.createdByName,
      decidedByName: row.decidedByName,
    },
    versions,
    usedIn,
  };
}

/** Approved memories the gateway adds to an agent's prompt for a client, newest first. */
export async function approvedMemoriesFor(
  db: Pick<Database, "select">,
  clientId: string,
  agent: AgentRole,
): Promise<Array<{ id: string; version: number; content: string }>> {
  return db
    .select({ id: memoryItems.id, version: memoryItems.version, content: memoryItems.content })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.clientId, clientId),
        eq(memoryItems.agent, agent),
        eq(memoryItems.status, "approved"),
      ),
    )
    .orderBy(desc(memoryItems.updatedAt))
    .limit(MEMORY_PROMPT_LIMIT);
}

/** Every human decision on a memory: a person holding `memory.approve`, never an agent. */
function person(actor: Actor, clientId?: string): Extract<Actor, { type: "user" }> {
  if (actor.type !== "user") throw new PermissionDeniedError("memory.approve", actor);
  assertCan(actor, "memory.approve", clientId);
  return actor;
}

const categorySchema = z.enum(memoryCategories);
const confidenceSchema = z.enum(memoryConfidences);

function content(text: string): string {
  const parsed = memoryContentSchema.safeParse(text);
  if (!parsed.success) throw localizedError("validation", "agents.memory.errors.content");
  return parsed.data;
}

export interface AgentMemoryInput {
  clientId: string;
  content: string;
  category: MemoryCategory;
  confidence: MemoryConfidence;
  confidenceReason?: string | null;
  runId?: string | null;
  sourceNote?: string | null;
  /** `observed`: a note of the agent; `candidate`: proposed for approval. */
  status: "observed" | "candidate";
}

/**
 * An agent writes a note or a proposal. It can never write an approved memory; a
 * client with policy `no_ai` gets no new memories from agents.
 */
export async function recordAgentMemory(
  db: Database,
  agent: AgentRole,
  input: AgentMemoryInput,
): Promise<MemoryItem> {
  const actor: Actor = { type: "agent", role: agent, runId: input.runId ?? undefined };
  assertCan(actor, "propose", input.clientId);
  const status = z.enum(["observed", "candidate"]).parse(input.status);
  const category = categorySchema.parse(input.category);
  const confidence = confidenceSchema.parse(input.confidence);
  const text = content(input.content);
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ aiPolicy: clients.aiPolicy })
      .from(clients)
      .where(eq(clients.id, input.clientId));
    if (!client) throw localizedError("not_found", "agents.memory.errors.notFound");
    if (client.aiPolicy === "no_ai")
      throw localizedError("policy_blocked", "agents.memory.errors.noAi");
    const [row] = await tx
      .insert(memoryItems)
      .values({
        clientId: input.clientId,
        agent,
        category,
        sensitive: isSensitiveMemoryCategory(category),
        content: text,
        status,
        confidence,
        confidenceReason: input.confidenceReason ?? null,
        proposedByAgent: agent,
        sourceRunId: input.runId ?? null,
        sourceNote: input.sourceNote ?? null,
      })
      .returning();
    await tx
      .insert(memoryItemVersions)
      .values({ memoryId: row!.id, version: 1, content: text, category, authorAgent: agent });
    await recordAuditEvent(tx, {
      actor,
      action: `memory.${status}`,
      entity: "memory",
      entityId: row!.id,
      clientId: input.clientId,
    });
    return row!;
  });
}

/** “Add memory”: a person's memory is approved at once (they are the approver). */
export async function addMemory(
  db: Database,
  actor: Actor,
  input: { clientId: string; agent: AgentRole; category: MemoryCategory; content: string },
): Promise<MemoryItem> {
  const user = person(actor, input.clientId);
  const category = categorySchema.parse(input.category);
  const text = content(input.content);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .insert(memoryItems)
      .values({
        clientId: input.clientId,
        agent: input.agent,
        category,
        sensitive: isSensitiveMemoryCategory(category),
        content: text,
        status: "approved",
        confidence: "high",
        createdBy: user.id,
        decidedBy: user.id,
        decidedAt: now,
      })
      .returning();
    await tx
      .insert(memoryItemVersions)
      .values({ memoryId: row!.id, version: 1, content: text, category, authorId: user.id });
    await recordAuditEvent(tx, {
      actor: user,
      action: "memory.added",
      entity: "memory",
      entityId: row!.id,
      clientId: input.clientId,
    });
    return row!;
  });
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Locks the row and checks it is in one of `from`; otherwise someone decided first. */
async function lockIn(tx: Tx, id: string, from: readonly MemoryStatus[]): Promise<MemoryItem> {
  const [row] = await tx.select().from(memoryItems).where(eq(memoryItems.id, id)).for("update");
  if (!row) throw localizedError("not_found", "agents.memory.errors.notFound");
  if (!from.includes(row.status)) {
    const [who] = row.decidedBy
      ? await tx.select({ name: users.name }).from(users).where(eq(users.id, row.decidedBy))
      : [];
    throw who
      ? localizedError(
          "conflict",
          "agents.memory.errors.alreadyDecidedBy",
          { name: who.name },
          { status: row.status },
        )
      : localizedError("conflict", "agents.memory.errors.alreadyDecided", undefined, {
          status: row.status,
        });
  }
  return row;
}

async function decide(
  db: Database,
  actor: Actor,
  id: string,
  from: readonly MemoryStatus[],
  check: (row: MemoryItem) => void,
  set: (userId: string) => Partial<typeof memoryItems.$inferInsert>,
  action: string,
): Promise<MemoryItem> {
  if (actor.type !== "user") throw new PermissionDeniedError("memory.approve", actor);
  return db.transaction(async (tx) => {
    const row = await lockIn(tx, id, from);
    const user = person(actor, row.clientId);
    check(row);
    const [updated] = await tx
      .update(memoryItems)
      .set(set(user.id))
      .where(eq(memoryItems.id, id))
      .returning();
    await recordAuditEvent(tx, {
      actor: user,
      action,
      entity: "memory",
      entityId: id,
      clientId: row.clientId,
    });
    return updated!;
  });
}

/** “Approve memory”. At low confidence a note is required. */
export async function approveMemory(
  db: Database,
  actor: Actor,
  id: string,
  note?: string | null,
): Promise<MemoryItem> {
  const text = note?.trim() ?? "";
  return decide(
    db,
    actor,
    id,
    ["candidate"],
    (row) => {
      if (row.confidence === "low" && text.length < 3)
        throw localizedError("validation", "agents.memory.errors.noteRequired");
    },
    (userId) => ({
      status: "approved",
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: text || null,
    }),
    "memory.approved",
  );
}

/** “Approve selected”: non-sensitive candidates at medium or high confidence only. */
export async function approveMemories(
  db: Database,
  actor: Actor,
  ids: readonly string[],
): Promise<number> {
  if (actor.type !== "user") throw new PermissionDeniedError("memory.approve", actor);
  if (ids.length === 0) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(memoryItems)
      .where(inArray(memoryItems.id, [...ids]))
      .for("update");
    if (rows.length !== ids.length)
      throw localizedError("not_found", "agents.memory.errors.notFound");
    for (const row of rows) {
      person(actor, row.clientId);
      if (row.status !== "candidate")
        throw localizedError("conflict", "agents.memory.errors.alreadyDecided", undefined, {
          status: row.status,
        });
      if (row.sensitive || row.confidence === "low")
        throw localizedError("validation", "agents.memory.errors.notBulk");
    }
    const now = new Date();
    await tx
      .update(memoryItems)
      .set({ status: "approved", decidedBy: actor.id, decidedAt: now, decisionNote: null })
      .where(inArray(memoryItems.id, [...ids]));
    for (const row of rows)
      await recordAuditEvent(tx, {
        actor,
        action: "memory.approved",
        entity: "memory",
        entityId: row.id,
        clientId: row.clientId,
        meta: { bulk: true },
      });
    return rows.length;
  });
}

/** “Reject memory”: reason required; the memory stays readable as `rejected`. */
export async function rejectMemory(
  db: Database,
  actor: Actor,
  id: string,
  reason: string,
): Promise<MemoryItem> {
  const text = reason.trim();
  if (text.length < 3 || text.length > 500)
    throw localizedError("validation", "agents.memory.errors.reasonRequired");
  return decide(
    db,
    actor,
    id,
    ["candidate", "observed"],
    () => {},
    (userId) => ({
      status: "rejected",
      decidedBy: userId,
      decidedAt: new Date(),
      decisionNote: text,
    }),
    "memory.rejected",
  );
}

/** “Propose as memory”: a person turns an agent's observed note into a candidate. */
export async function promoteMemory(db: Database, actor: Actor, id: string): Promise<MemoryItem> {
  return decide(
    db,
    actor,
    id,
    ["observed"],
    () => {},
    () => ({ status: "candidate" }),
    "memory.promoted",
  );
}

/** “Archive memory”: agents stop using it; it stays readable among the archived. */
export async function archiveMemory(db: Database, actor: Actor, id: string): Promise<MemoryItem> {
  return decide(
    db,
    actor,
    id,
    ["approved"],
    () => {},
    (userId) => ({ status: "archived", decidedBy: userId, decidedAt: new Date() }),
    "memory.archived",
  );
}

/**
 * “Edit”: the next version, with the person as author; earlier versions stay in the
 * history. Editing an approved memory keeps it approved.
 */
export async function editMemory(
  db: Database,
  actor: Actor,
  id: string,
  input: { content: string; category?: MemoryCategory },
): Promise<MemoryItem> {
  if (actor.type !== "user") throw new PermissionDeniedError("memory.approve", actor);
  const text = content(input.content);
  return db.transaction(async (tx) => {
    const row = await lockIn(tx, id, ["candidate", "approved"]);
    const user = person(actor, row.clientId);
    const category = input.category ? categorySchema.parse(input.category) : row.category;
    const version = row.version + 1;
    const [updated] = await tx
      .update(memoryItems)
      .set({
        content: text,
        category,
        sensitive: isSensitiveMemoryCategory(category),
        version,
      })
      .where(eq(memoryItems.id, id))
      .returning();
    await tx
      .insert(memoryItemVersions)
      .values({ memoryId: id, version, content: text, category, authorId: user.id });
    await recordAuditEvent(tx, {
      actor: user,
      action: "memory.edited",
      entity: "memory",
      entityId: id,
      clientId: row.clientId,
      meta: { version },
    });
    return updated!;
  });
}

export interface MemorySettingEntry<K extends MemorySettingKey = MemorySettingKey> {
  key: K;
  value: MemorySettingValues[K];
  version: number;
  updatedByName: string | null;
  updatedAt: Date;
}

export type ClientMemorySettings = { [K in MemorySettingKey]?: MemorySettingEntry<K> };

/** Structured settings of a client; a stored value that no longer validates is left out. */
export async function loadClientMemorySettings(
  db: Pick<Database, "select">,
  clientId: string,
): Promise<ClientMemorySettings> {
  const rows = await db
    .select({
      key: clientMemorySettings.key,
      value: clientMemorySettings.value,
      version: clientMemorySettings.version,
      updatedByName: users.name,
      updatedAt: clientMemorySettings.updatedAt,
    })
    .from(clientMemorySettings)
    .leftJoin(users, eq(users.id, clientMemorySettings.updatedBy))
    .where(eq(clientMemorySettings.clientId, clientId));
  const out: Record<string, MemorySettingEntry> = {};
  for (const r of rows) {
    const parsed = memorySettingSchemas[r.key].safeParse(r.value);
    if (parsed.success) out[r.key] = { ...r, value: parsed.data as never };
  }
  return out as ClientMemorySettings;
}

/** Sets (or with `null` clears) one structured value. People only: an agent may never. */
export async function saveClientMemorySetting(
  db: Database,
  actor: Actor,
  clientId: string,
  key: MemorySettingKey,
  value: unknown,
): Promise<void> {
  const user = person(actor, clientId);
  z.enum(memorySettingKeys).parse(key);
  await db.transaction(async (tx) => {
    if (value === null) {
      await tx
        .delete(clientMemorySettings)
        .where(and(eq(clientMemorySettings.clientId, clientId), eq(clientMemorySettings.key, key)));
    } else {
      const parsed = memorySettingSchemas[key].safeParse(value);
      if (!parsed.success)
        throw localizedError("validation", `agents.memory.errors.setting.${key}`);
      await tx
        .insert(clientMemorySettings)
        .values({ clientId, key, value: parsed.data, updatedBy: user.id })
        .onConflictDoUpdate({
          target: [clientMemorySettings.clientId, clientMemorySettings.key],
          set: {
            value: parsed.data,
            updatedBy: user.id,
            version: sql`${clientMemorySettings.version} + 1`,
          },
        });
    }
    await recordAuditEvent(tx, {
      actor: user,
      action: "memory.setting_changed",
      entity: "client",
      entityId: clientId,
      clientId,
      meta: { key, value: value === null ? null : (value as object) },
    });
  });
}
