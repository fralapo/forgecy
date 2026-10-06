import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

let shared: Database | undefined;

/** Create a database handle. Each process normally uses `getDb()` instead. */
export function createDb(url: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  return drizzle(pool, { schema, casing: "snake_case" }) as Database;
}

/** Process-wide database handle built from DATABASE_URL. */
export function getDb(): Database {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    shared = createDb(url);
  }
  return shared;
}
