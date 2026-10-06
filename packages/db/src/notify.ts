import type { NotificationKind, NotificationParams } from "@forgecy/core";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "./client";
import { clients, notifications, users } from "./schema";

type Tx = Pick<Database, "insert" | "select">;

export interface NotifyInput {
  kind: NotificationKind;
  /** User ids, or every active person (e.g. a review with no chosen reviewer). */
  to: (string | null | undefined)[] | "everyone";
  /** Usually the person who acted: never notified about their own action. */
  except?: string | null;
  /** Adds the `client` parameter (its name) and the slug for `href`. */
  clientId?: string | null;
  params?: NotificationParams;
  /** App path; a function receives the client's slug. */
  href: string | ((clientSlug: string) => string);
}

/**
 * Notify people in the bell. Call it in the same transaction as the change it
 * describes, like `recordAuditEvent`. Inactive accounts are skipped.
 */
export async function notify(db: Tx, input: NotifyInput): Promise<number> {
  const wanted =
    input.to === "everyone"
      ? null
      : [...new Set(input.to.filter((x): x is string => !!x && x !== input.except))];
  if (wanted && !wanted.length) return 0;
  const recipients = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(
        wanted ? and(eq(users.active, true), inArray(users.id, wanted)) : eq(users.active, true),
      )
  )
    .map((u) => u.id)
    .filter((id) => id !== input.except);
  if (!recipients.length) return 0;

  let params = input.params ?? {};
  let slug = "";
  if (input.clientId) {
    const [c] = await db
      .select({ name: clients.name, slug: clients.slug })
      .from(clients)
      .where(eq(clients.id, input.clientId));
    if (c) {
      params = { client: c.name, ...params };
      slug = c.slug;
    }
  }
  const href = typeof input.href === "function" ? input.href(slug) : input.href;
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      kind: input.kind,
      clientId: input.clientId ?? null,
      params,
      href,
    })),
  );
  return recipients.length;
}

/** The reader's own notifications, newest first: nobody reads someone else's. */
export async function listNotifications(
  db: Pick<Database, "select">,
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(options.limit ?? 50, 200));
}

export async function unreadNotificationCount(
  db: Pick<Database, "select">,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Marks the reader's own notifications as read: the given ones, or all of them. */
export async function markNotificationsRead(
  db: Pick<Database, "update">,
  userId: string,
  ids?: string[],
): Promise<void> {
  if (ids && !ids.length) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
}
