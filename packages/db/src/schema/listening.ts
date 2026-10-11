import { listeningPlatforms, listeningStatuses } from "@forgecy/core";
import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { contents } from "./content";
import { createdAt, id, updatedAt } from "./_common";

export const listeningPlatformEnum = pgEnum("listening_platform", listeningPlatforms);
export const listeningStatusEnum = pgEnum("listening_status", listeningStatuses);

/** A verbatim signal from a client's audience (comment, DM, question, mention). Logged by hand. */
export const listeningSignals = pgTable(
  "listening_signals",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** The words as written by the person, never paraphrased. */
    text: text("text").notNull(),
    platform: listeningPlatformEnum("platform").notNull().default("instagram"),
    url: text("url"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    tag: text("tag"),
    status: listeningStatusEnum("status").notNull().default("new"),
    /** The content a person made from this signal, if any. */
    linkedContentId: uuid("linked_content_id").references(() => contents.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("listening_signals_client_idx").on(t.clientId, t.status, t.occurredAt)],
);
