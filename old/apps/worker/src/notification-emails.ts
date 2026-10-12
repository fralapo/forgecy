import { isLocale } from "@forgecy/core";
import {
  claimNotificationEmails,
  releaseNotificationEmails,
  type Database,
  type NotificationEmailRow,
} from "@forgecy/db";
import { renderNotificationsEmail, type Mailer } from "@forgecy/mail";

/**
 * Emails the new notifications of the people who opted in (Settings › Preferences):
 * one email per person and round. Unsent ones go back for the next round.
 */
export async function sendNotificationEmails(
  db: Database,
  mailer: Mailer,
  baseUrl: string,
): Promise<{ sent: number; failed: number }> {
  if (!mailer.configured) return { sent: 0, failed: 0 };
  const rows = await claimNotificationEmails(db);
  const byUser = new Map<string, NotificationEmailRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  let sent = 0;
  const failed: string[] = [];
  for (const list of byUser.values()) {
    const first = list[0]!;
    try {
      const message = await renderNotificationsEmail({
        locale: isLocale(first.locale) ? first.locale : undefined,
        // Opening goes through the bell, which marks it read.
        notifications: list.map((n) => ({
          kind: n.kind,
          params: n.params,
          url: new URL(`/notifications/${n.id}`, baseUrl).toString(),
        })),
        settingsUrl: new URL("/settings", baseUrl).toString(),
      });
      await mailer.sendMail({ to: first.email, ...message });
      sent += list.length;
    } catch {
      failed.push(...list.map((n) => n.id));
    }
  }
  await releaseNotificationEmails(db, failed);
  return { sent, failed: failed.length };
}
