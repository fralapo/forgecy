/**
 * Apply pending migrations. Run by the `migrate` service in Docker Compose before
 * web and worker start, and by `pnpm db:migrate` in development.
 */
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = createDb(url, { max: 1 });
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
await migrate(db, { migrationsFolder });
await db.$client.end();
console.log("Migrations applied");
