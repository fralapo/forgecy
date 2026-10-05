import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { aiPolicyEnum, clientStatusEnum } from "./enums";

/** Prospects and clients live in one table; `status` moves a prospect to active. */
export const clients = pgTable(
  "clients",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: clientStatusEnum("status").notNull().default("prospect"),
    websiteUrl: text("website_url"),
    sector: text("sector"),
    notes: text("notes"),
    aiPolicy: aiPolicyEnum("ai_policy").notNull().default("external_allowed"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_status_idx").on(t.status)],
);
