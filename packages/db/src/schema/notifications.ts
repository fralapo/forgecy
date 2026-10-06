/**
 * In-app notifications (bell in the header, v1): one row per recipient. The text is
 * not stored: `kind` and `params` are rendered in the reader's language.
 */
import { notificationKinds, type NotificationParams } from "@forgecy/core";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt, id } from "./_common";

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: notificationKinds }).notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    params: jsonb("params").$type<NotificationParams>().notNull().default({}),
    /** App path the notification opens, e.g. `/content/acme/carousels/<id>/review`. */
    href: text("href").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);
