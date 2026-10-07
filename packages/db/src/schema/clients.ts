import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common";
import { aiPolicyEnum, clientStatusEnum, providerEnum, sendableAssetEnum } from "./enums";

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
    /** external_restricted only: the external providers that may receive this client's data. */
    approvedProviders: providerEnum("approved_providers")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * external_restricted only: the kinds of files and texts that may go to those
     * providers. All kinds by default, so restricting a client changes nothing until
     * an Admin unchecks one.
     */
    sendableAssets: sendableAssetEnum("sendable_assets")
      .array()
      .notNull()
      .default(sql`'{brand_assets,client_photos,audit_screenshots,documents,brand_texts}'`),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_status_idx").on(t.status)],
);
