import type { NotificationKind, NotificationParams } from "@forgecy/core";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { withClientAccess } from "./client-access";
import { clientAccess, clients, notifications, users } from "./schema";

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
  let recipients = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(
        wanted ? and(eq(users.active, true), inArray(users.id, wanted)) : eq(users.active, true),
      )
  )
    .map((u) => u.id)
    .filter((id) => id !== input.except);
  // Nobody hears about a client they cannot open (ADR 0020).
  if (input.clientId) recipients = await withClientAccess(db, input.clientId, recipients);
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

/**
 * Notifications about a client stay hidden once the reader can no longer open it (ADR 0020):
 * new ones are not sent (`notify`), and this hides the ones sent before.
 */
const stillVisible = sql`(${notifications.clientId} is null
  or exists (select 1 from ${users} where ${users.id} = ${notifications.userId} and ${users.isAdmin})
  or exists (select 1 from ${clientAccess} where ${clientAccess.userId} = ${notifications.userId}
    and ${clientAccess.clientId} = ${notifications.clientId}))`;

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
        stillVisible,
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
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), stillVisible));
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

/** A notification to email, with what the email needs about its recipient. */
export interface NotificationEmailRow {
  id: string;
  userId: string;
  email: string;
  locale: string | null;
  kind: NotificationKind;
  params: NotificationParams;
  href: string;
}

/**
 * Takes the notifications still to email for people who opted in, created in the last
 * `withinMinutes`, and marks them emailed in the same statement: two workers never
 * send the same one. Call `releaseNotificationEmails` for those that failed to send.
 */
export async function claimNotificationEmails(
  db: Pick<Database, "execute">,
  withinMinutes = 60,
): Promise<NotificationEmailRow[]> {
  const result = await db.execute(sql`
    update ${notifications} n set emailed_at = now()
    from ${users} u
    where n.user_id = u.id
      and n.emailed_at is null
      and n.read_at is null
      and u.email_notifications
      and u.active
      and n.created_at > now() - make_interval(mins => ${withinMinutes})
    returning n.id, n.user_id as "userId", u.email, u.locale, n.kind, n.params, n.href`);
  return result.rows as unknown as NotificationEmailRow[];
}

/** Puts back notifications whose email could not be sent, for the next attempt. */
export async function releaseNotificationEmails(
  db: Pick<Database, "update">,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  await db.update(notifications).set({ emailedAt: null }).where(inArray(notifications.id, ids));
}
