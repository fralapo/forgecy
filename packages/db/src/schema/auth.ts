/**
 * Identity tables used by Better Auth (users, sessions, accounts, verifications).
 * One human account type; `isAdmin` unlocks settings, `isProductOwner` marks the
 * Forgecy Product Owner. Passwords live in `accounts.password` (provider "credential").
 */
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { LOCALES } from "@forgecy/core";
import { createdAt, id, updatedAt } from "./_common";

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAdmin: boolean("is_admin").notNull().default(false),
  isProductOwner: boolean("is_product_owner").notNull().default(false),
  active: boolean("active").notNull().default(true),
  /** Interface language chosen by the person (`en`, `it`); null follows the browser. */
  locale: text("locale", { enum: LOCALES }),
  /** Also receive the bell's notifications by email (opt-in, needs SMTP). */
  emailNotifications: boolean("email_notifications").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

/** Magic link and email verification tokens; magic link tokens are stored hashed. */
export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
