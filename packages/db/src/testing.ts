/**
 * Test-only helpers (import from "@forgecy/db/testing"): a scripted fake of the Drizzle
 * query builder that records the WHERE clauses it receives as SQL text, so unit tests can
 * pin compare-and-set predicates without a Postgres.
 */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database } from "./client";

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
