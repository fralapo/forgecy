/**
 * Which clients a person may see and work on (ADR 0020). Admins see every client and need
 * no row; everyone else sees only the clients assigned to them here.
 */
import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt } from "./_common";

export const clientAccess = pgTable(
  "client_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    /** Who assigned it; null for the upgrade backfill or when that person was deleted. */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.clientId] }),
    index("client_access_client_id_idx").on(t.clientId),
  ],
);
