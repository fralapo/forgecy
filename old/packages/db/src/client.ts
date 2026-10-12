import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

let shared: Database | undefined;

export interface CreateDbOptions {
  max?: number;
  /** Called when an idle pooled client fails (Postgres restart, network drop). Default: one JSON line on stderr. */
  onError?: (err: Error) => void;
}

/** Create a database handle. Each process normally uses `getDb()` instead. */
export function createDb(url: string, options: CreateDbOptions = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: options.max ?? 10 });
  // Idle clients stay connected, so a Postgres restart makes the pool emit 'error'.
  // Without a listener Node treats it as an uncaught exception and kills the process;
  // the pool already drops the dead client and opens a new one on demand.
  pool.on(
    "error",
    options.onError ??
      ((err) => {
        process.stderr.write(
          `${JSON.stringify({ level: "error", service: "db", msg: "idle postgres client error", err: err.message })}
`,
        );
      }),
  );
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
