import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

/**
 * Folder of the SQL migrations shipped with this version. Built from a path rather than
 * `new URL(...)` so bundlers (the web app imports this module) don't try to resolve it.
 */
export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

/** Applies the shipped migrations on a dedicated connection (used after a restore). */
export async function applyMigrations(url: string): Promise<void> {
  const db = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await db.$client.end();
  }
}
