import "server-only";
import { accounts, getDb, recordAuditEvent, sql, users } from "@forgecy/db";
import { hashPassword } from "better-auth/crypto";

/**
 * Serialize first-run setup across concurrent requests with a Postgres advisory lock,
 * so two submissions cannot both create an "only" Admin.
 */
export async function withSetupLock<T>(fn: () => Promise<T>): Promise<T> {
  const client = await getDb().$client.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('forgecy.setup'))");
    return await fn();
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('forgecy.setup'))")
      .catch(() => undefined);
    client.release();
  }
}

export async function countUsers(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(users);
  return row?.n ?? 0;
}

/**
 * Create a password account directly, since public sign-up is disabled.
 * Used by the first-run setup and, later, by the Admin users page.
 */
export async function createPasswordUser(input: {
  name: string;
  email: string;
  password: string;
  isAdmin: boolean;
  isProductOwner?: boolean;
  createdBy?: string;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  // Same rows Better Auth writes for an email/password sign-up (provider "credential").
  return getDb().transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        name: input.name.trim(),
        email,
        emailVerified: true,
        isAdmin: input.isAdmin,
        isProductOwner: input.isProductOwner ?? false,
      })
      .returning({ id: users.id });
    await tx.insert(accounts).values({
      userId: user!.id,
      providerId: "credential",
      accountId: user!.id,
      password: passwordHash,
    });
    await recordAuditEvent(tx, {
      actor: input.createdBy
        ? { type: "user", id: input.createdBy, isAdmin: true, active: true }
        : "system",
      action: "user.create",
      entity: "user",
      entityId: user!.id,
      meta: { isAdmin: input.isAdmin },
    });
    return { id: user!.id };
  });
}
