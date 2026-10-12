/**
 * Test-only helpers (import from "@forgecy/db/testing"): a scripted fake of the Drizzle
 * query builder that records the WHERE clauses it receives as SQL text, so unit tests can
 * pin compare-and-set predicates without a Postgres.
 */
import type { Actor } from "@forgecy/core";
import { inArray, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "./client";
import { userActor } from "./client-access";
import { clientAccess, clients, users } from "./schema";

const dialect = new PgDialect();

/** Render a drizzle condition, e.g. `("jobs"."id" = $1 and "jobs"."attempts" = $2)`. */
export function renderSql(query: SQL): { sql: string; params: unknown[] } {
  const { sql, params } = dialect.sqlToQuery(query);
  return { sql, params };
}

export interface FakeDbScript {
  /** Rows returned by the 1st, 2nd... `select()` call (then `[]`). */
  selects?: unknown[][];
  /** Rows returned by the 1st, 2nd... `update()` call, i.e. what `.returning()` yields. */
  updates?: unknown[][];
  inserts?: unknown[][];
}

export interface FakeDb {
  db: Database;
  /** One entry per `.where()`: `"update: <sql>"` or `"select: <sql>"`, in call order. */
  wheres: string[];
  /** Values given to `.set()`, per update. */
  sets: Record<string, unknown>[];
  /** Top-level calls in order: select | update | insert | execute | transaction. */
  calls: string[];
  /** Rendered `db.execute(sql)` statements (advisory locks etc.). */
  executed: { sql: string; params: unknown[] }[];
}

export function createFakeDb(script: FakeDbScript = {}): FakeDb {
  const rows = {
    select: [...(script.selects ?? [])],
    update: [...(script.updates ?? [])],
    insert: [...(script.inserts ?? [])],
  };
  const wheres: string[] = [];
  const sets: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const executed: { sql: string; params: unknown[] }[] = [];

  const chain = (kind: "select" | "update" | "insert") => {
    const result = rows[kind].shift() ?? [];
    const c: Record<string, unknown> = {};
    for (const m of [
      "from",
      "orderBy",
      "limit",
      "groupBy",
      "innerJoin",
      "leftJoin",
      "values",
      "returning",
      "onConflictDoNothing",
      "onConflictDoUpdate",
    ])
      c[m] = () => c;
    c.set = (v: Record<string, unknown>) => {
      sets.push(v);
      return c;
    };
    c.where = (cond?: SQL) => {
      wheres.push(`${kind}: ${cond ? renderSql(cond).sql : ""}`);
      return c;
    };
    c.then = (ok?: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err);
    return c;
  };

  const db: Record<string, unknown> = {
    select: () => {
      calls.push("select");
      return chain("select");
    },
    update: () => {
      calls.push("update");
      return chain("update");
    },
    insert: () => {
      calls.push("insert");
      return chain("insert");
    },
    execute: async (q: SQL) => {
      calls.push("execute");
      executed.push(renderSql(q));
      return { rows: [] };
    },
    transaction: async (cb: (tx: unknown) => unknown) => {
      calls.push("transaction");
      return cb(db);
    },
  };
  return { db: db as unknown as Database, wheres, sets, calls, executed };
}

type UserActor = Extract<Actor, { type: "user" }>;

/** People and clients for per-client access tests (ADR 0020), made with real rows. */
export interface AccessFixture {
  /** Assigned to client X only. */
  member: UserActor;
  /** No client assigned: sees none. */
  nobody: UserActor;
  admin: UserActor;
  x: { id: string; slug: string; name: string };
  y: { id: string; slug: string; name: string };
  cleanup(): Promise<void>;
}

/**
 * Creates an Admin, a member assigned to client X, a person with no client and the two
 * clients X and Y (status `active` unless given). `cleanup` deletes them and what cascades.
 */
export async function createAccessFixture(
  db: Database,
  options: { status?: "prospect" | "active" } = {},
): Promise<AccessFixture> {
  const tag = Math.random().toString(36).slice(2, 8);
  const people = await db
    .insert(users)
    .values([
      { name: `Admin ${tag}`, email: `acl-admin-${tag}@example.test`, isAdmin: true },
      { name: `Member ${tag}`, email: `acl-member-${tag}@example.test` },
      { name: `Nobody ${tag}`, email: `acl-nobody-${tag}@example.test` },
    ])
    .returning({ id: users.id });
  const made = await db
    .insert(clients)
    .values(
      ["x", "y"].map((k) => ({
        name: `ACL ${k.toUpperCase()} ${tag}`,
        slug: `acl-${k}-${tag}`,
        status: options.status ?? "active",
      })),
    )
    .returning({ id: clients.id, slug: clients.slug, name: clients.name });
  const [x, y] = made as [AccessFixture["x"], AccessFixture["y"]];
  await db.insert(clientAccess).values({ userId: people[1]!.id, clientId: x.id });
  const actor = async (id: string) => (await userActor(db, id))!;
  const ids = people.map((p) => p.id);
  return {
    admin: await actor(ids[0]!),
    member: await actor(ids[1]!),
    nobody: await actor(ids[2]!),
    x,
    y,
    async cleanup() {
      await db.delete(clients).where(inArray(clients.id, [x.id, y.id]));
      await db.delete(users).where(inArray(users.id, ids));
    },
  };
}
