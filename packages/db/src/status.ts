import journal from "../migrations/meta/_journal.json" with { type: "json" };
import { sql } from "drizzle-orm";
import type { Database } from "./client";

export interface MigrationStatus {
  /** Migrations shipped with this version of Forgecy. */
  total: number;
  applied: number;
  /** Tags shipped but not yet applied (run `pnpm forgecy migrate`). */
  pending: string[];
  lastApplied: string | null;
}

/** Compares the shipped migration journal with drizzle's table of applied migrations. */
export async function migrationStatus(db: Pick<Database, "execute">): Promise<MigrationStatus> {
  const res = await db.execute<{ created_at: string }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at`,
  );
  const appliedWhen = new Set(res.rows.map((r) => Number(r.created_at)));
  const entries = journal.entries;
  const applied = entries.filter((e) => appliedWhen.has(e.when));
  return {
    total: entries.length,
    applied: applied.length,
    pending: entries.filter((e) => !appliedWhen.has(e.when)).map((e) => e.tag),
    lastApplied: applied.at(-1)?.tag ?? null,
  };
}

export interface DatabaseInfo {
  version: string;
  sizeBytes: number;
  connections: number;
  maxConnections: number;
  pgvector: string | null;
  latencyMs: number;
}

export async function databaseInfo(db: Pick<Database, "execute">): Promise<DatabaseInfo> {
  const started = performance.now();
  await db.execute(sql`select 1`);
  const latencyMs = performance.now() - started;
  const res = await db.execute<{
    version: string;
    size: string;
    connections: string;
    max_connections: string;
    pgvector: string | null;
  }>(sql`select
    current_setting('server_version') as version,
    pg_database_size(current_database()) as size,
    (select count(*) from pg_stat_activity where datname = current_database()) as connections,
    current_setting('max_connections') as max_connections,
    (select extversion from pg_extension where extname = 'vector') as pgvector`);
  const row = res.rows[0]!;
  return {
    version: row.version,
    sizeBytes: Number(row.size),
    connections: Number(row.connections),
    maxConnections: Number(row.max_connections),
    pgvector: row.pgvector,
    latencyMs,
  };
}

/** Shipped migration tags in order. */
export const shippedMigrations: readonly { tag: string; when: number }[] = journal.entries;
