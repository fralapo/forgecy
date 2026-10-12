import type { NotificationKind } from "@forgecy/core";
import { getDb, listNotifications } from "@forgecy/db";
import { Button, Card } from "@forgecy/ui";
import { Circle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getFormat } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import { markAllReadAction } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("notifications");
  return { title: t("title") };
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const t = await getTranslations("notifications");
  const format = await getFormat();
  const rows = await listNotifications(getDb(), user.id, { limit: 100 });
  const unread = rows.some((r) => !r.readAt);
  const message = (kind: NotificationKind, params: Record<string, string | number>) =>
    t(`kinds.${kind}`, params);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          unread ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="secondary" size="sm">
                {t("markAllRead")}
              </Button>
            </form>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Card className="p-6">
          <p className="text-body-md text-fg-muted">{t("empty")}</p>
        </Card>
      ) : (
        <ul className="divide-y divide-subtle rounded-lg border border-subtle bg-surface">
          {rows.map((n) => (
            <li key={n.id}>
              {/* A plain link: prefetching would mark it read. */}
              <a
                href={`/notifications/${n.id}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-app focus-visible:outline-2 focus-visible:outline-focus"
              >
                {n.readAt ? (
                  <span aria-hidden className="mt-1.5 size-2 shrink-0" />
                ) : (
                  <Circle
                    aria-hidden
                    className="mt-1.5 size-2 shrink-0 fill-primary text-primary"
                  />
                )}
                <span className="grid gap-0.5">
                  <span
                    className={n.readAt ? "text-body-sm text-fg-muted" : "text-body-sm text-fg"}
                  >
                    {message(n.kind, n.params)}
                    {n.readAt ? null : <span className="sr-only"> · {t("unread")}</span>}
                  </span>
                  <span className="text-body-sm text-fg-muted">
                    {format.date(n.createdAt, "dateTime")}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
