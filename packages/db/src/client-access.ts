/**
 * Per-client access (ADR 0020): the SQL side of `canAccessClient` in @forgecy/core.
 * `loadClientScope` reads a person's assignments once, when their actor is built;
 * `clientScopeWhere` narrows any list to the clients that actor may see.
 */
import { assertCan, type Actor, type ClientScope } from "@forgecy/core";
import { and, eq, inArray, sql, type Column, type SQL } from "drizzle-orm";
import { recordAuditEvent } from "./audit";
import type { Database } from "./client";
import { clientAccess, users } from "./schema";

type Reader = Pick<Database, "select">;
type Writer = Pick<Database, "insert">;

/** The ids of the clients assigned to a person (Admins need none: they see every client). */
export async function loadClientScope(db: Reader, userId: string): Promise<string[]> {
  const rows = await db
    .select({ clientId: clientAccess.clientId })
    .from(clientAccess)
    .where(eq(clientAccess.userId, userId));
  return rows.map((r) => r.clientId);
}

/** What an actor may reach, from the user row: every client for an Admin, else the assigned ones. */
export async function clientScopeOf(
  db: Reader,
  user: { id: string; isAdmin: boolean },
): Promise<ClientScope> {
  return user.isAdmin ? "all" : loadClientScope(db, user.id);
}

/**
 * The actor of a person read from the database, with their client scope; null when the
 * account does not exist. The worker uses it for jobs a person started, so a job does not
 * reach further than its owner can today.
 */
export async function userActor(
  db: Reader,
  userId: string,
): Promise<Extract<Actor, { type: "user" }> | null> {
  const [user] = await db
    .select({ id: users.id, isAdmin: users.isAdmin, active: users.active })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  return { type: "user", ...user, clients: await clientScopeOf(db, user) };
}

/**
 * A condition limiting a query to the clients the actor may see, on `column` (a client id
 * column). Undefined when nothing needs filtering (Admins, agents), so it drops out of `and()`.
 */
export function clientScopeWhere(actor: Actor, column: Column): SQL | undefined {
  if (actor.type === "agent") return undefined;
  if (!actor.active) return sql`false`;
  if (actor.isAdmin || actor.clients === "all") return undefined;
  if (!actor.clients.length) return sql`false`;
  return inArray(column, [...actor.clients]);
}

/** Assigns a client to a person; already assigned is fine. Used when someone creates a client. */
export async function grantClientAccess(
  db: Writer,
  input: { userId: string; clientId: string; createdBy: string | null },
): Promise<void> {
  await db.insert(clientAccess).values(input).onConflictDoNothing();
}

/** Admin only: assign or unassign a client, with an activity log entry. */
export async function setClientAccess(
  db: Database,
  actor: Actor,
  input: { userId: string; clientId: string; granted: boolean },
): Promise<void> {
  assertCan(actor, "users.manage");
  const by = actor.type === "user" ? actor.id : null;
  await db.transaction(async (tx) => {
    if (input.granted) {
      const added = await tx
        .insert(clientAccess)
        .values({ userId: input.userId, clientId: input.clientId, createdBy: by })
        .onConflictDoNothing()
        .returning({ userId: clientAccess.userId });
      if (!added.length) return;
    } else {
      const removed = await tx
        .delete(clientAccess)
        .where(
          and(eq(clientAccess.userId, input.userId), eq(clientAccess.clientId, input.clientId)),
        )
        .returning({ userId: clientAccess.userId });
      if (!removed.length) return;
    }
    await recordAuditEvent(tx, {
      actor,
      action: input.granted ? "client_access.grant" : "client_access.revoke",
      entity: "client",
      entityId: input.clientId,
      clientId: input.clientId,
      meta: { userId: input.userId },
    });
  });
}

/** Admin only: every assignment, for the Settings screen. */
export async function listClientAccess(db: Database, actor: Actor) {
  assertCan(actor, "users.manage");
  return db
    .select({ userId: clientAccess.userId, clientId: clientAccess.clientId })
    .from(clientAccess);
}

/**
 * The people who can open a client: every active Admin and the active people assigned to
 * it. Needs access to the client itself.
 */
export async function clientMembers(db: Database, actor: Actor, clientId: string) {
  assertCan(actor, "view", clientId);
  return db
    .select({ id: users.id, name: users.name, isAdmin: users.isAdmin })
    .from(users)
    .where(
      and(
        eq(users.active, true),
        sql`(${users.isAdmin} or exists (select 1 from ${clientAccess} where ${clientAccess.userId} = ${users.id} and ${clientAccess.clientId} = ${clientId}))`,
      ),
    )
    .orderBy(users.name);
}

/** Keeps the given user ids that may open the client (active Admins and assigned people). */
export async function withClientAccess(
  db: Reader,
  clientId: string,
  userIds: string[],
): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, userIds),
        sql`(${users.isAdmin} or exists (select 1 from ${clientAccess} where ${clientAccess.userId} = ${users.id} and ${clientAccess.clientId} = ${clientId}))`,
      ),
    );
  return rows.map((r) => r.id);
}
