import { appSettings, eq, type Database } from "@forgecy/db";
import type { LiveSource } from "./runtime";

/** app_settings key. The value maps a source to the ISO time it was stopped. */
const BLOCKED_KEY = "social.blocked";

type Blocked = Partial<Record<LiveSource, string>>;

function asBlocked(value: unknown): Blocked {
  return value && typeof value === "object" ? (value as Blocked) : {};
}

/**
 * A source that answered with a challenge or login wall stays stopped across restarts:
 * a person has to resume it (`resumeSource`), because retrying is how accounts and IPs get banned.
 */
export async function blockedSources(db: Database): Promise<Blocked> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, BLOCKED_KEY));
  return asBlocked(row?.value);
}

export async function markSourceBlocked(db: Database, source: LiveSource, at: Date): Promise<void> {
  const next: Blocked = { ...(await blockedSources(db)), [source]: at.toISOString() };
  await db
    .insert(appSettings)
    .values({ key: BLOCKED_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next } });
}

export async function clearSourceBlocked(
  db: Database,
  source: LiveSource,
  by: string | null,
): Promise<void> {
  const next: Blocked = { ...(await blockedSources(db)) };
  delete next[source];
  await db
    .insert(appSettings)
    .values({ key: BLOCKED_KEY, value: next, updatedBy: by })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedBy: by } });
}
