import { socialProfileRoles, socialProfileStatuses, socialSnapshotSources } from "@forgecy/core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audits } from "./audit";
import { users } from "./auth";
import { clients } from "./clients";
import { createdAt, id, updatedAt } from "./_common";

// Instagram profile analysis (ADR 0023). Enum values come from @forgecy/core (social.ts).
export const socialProfileRoleEnum = pgEnum("social_profile_role", socialProfileRoles);
export const socialProfileStatusEnum = pgEnum("social_profile_status", socialProfileStatuses);
export const socialSnapshotSourceEnum = pgEnum("social_snapshot_source", socialSnapshotSources);

/** A public Instagram business profile followed for a client: its own, a competitor or a prospect. */
export const socialProfiles = pgTable(
  "social_profiles",
  {
    id: id(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Lowercase, without "@". */
    handle: text("handle").notNull(),
    role: socialProfileRoleEnum("role").notNull().default("competitor"),
    /** The audit this profile was added from, if any. */
    auditId: uuid("audit_id").references(() => audits.id, { onDelete: "set null" }),
    /** Null picks the best configured source. */
    preferredSource: socialSnapshotSourceEnum("preferred_source"),
    monitored: boolean("monitored").notNull().default(false),
    intervalHours: integer("interval_hours").notNull().default(24),
    status: socialProfileStatusEnum("status").notNull().default("pending"),
    /** Message key plus values of the last failure, shown in the user's language. */
    statusReason: jsonb("status_reason").$type<{
      key: string;
      values?: Record<string, string | number>;
    }>(),
    lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
    /** Newest post already stored: the next run only needs newer ones. */
    latestPostAt: timestamp("latest_post_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("social_profiles_client_handle_uq").on(t.clientId, t.handle),
    index("social_profiles_due_idx").on(t.monitored, t.status, t.nextRunAt),
  ],
);

/** The profile as one source gave it at one time (counts, bio, link, picture hash). */
export const socialSnapshots = pgTable(
  "social_snapshots",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    source: socialSnapshotSourceEnum("source").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** ProfileSnapshot of @forgecy/social, kept with the version of its shape. */
    profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    postCount: integer("post_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("social_snapshots_profile_idx").on(t.profileId, t.observedAt)],
);

/** A public post, updated in place on every run (metrics move; the first sighting is kept). */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull(),
    shortcode: text("shortcode"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    caption: text("caption"),
    likes: integer("likes"),
    comments: integer("comments"),
    views: integer("views"),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    taggedAccounts: jsonb("tagged_accounts").$type<string[]>().notNull().default([]),
    collaborators: jsonb("collaborators").$type<string[]>().notNull().default([]),
    location: text("location"),
    isSponsored: boolean("is_sponsored").notNull().default(false),
    isPinned: boolean("is_pinned"),
    carouselCount: integer("carousel_count"),
    accessibilityCaption: text("accessibility_caption"),
    source: socialSnapshotSourceEnum("source").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_posts_profile_post_uq").on(t.profileId, t.postId),
    index("social_posts_profile_idx").on(t.profileId, t.postedAt),
  ],
);

/** Public relationships of a brand: accounts it tags, mentions or co-posts with, with validity windows. */
export const socialEdges = pgTable(
  "social_edges",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    dst: text("dst").notNull(),
    /** tags | mentions | collab */
    kind: text("kind").notNull(),
    count: integer("count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    postIds: jsonb("post_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex("social_edges_uq").on(t.profileId, t.dst, t.kind),
    index("social_edges_dst_idx").on(t.dst),
  ],
);

/** Append-only change log: what changed on a profile between two snapshots. */
export const socialEvents = pgTable(
  "social_events",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => socialProfiles.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    old: text("old"),
    new: text("new"),
    postId: text("post_id"),
    createdAt: createdAt(),
  },
  (t) => [index("social_events_profile_idx").on(t.profileId, t.at)],
);
