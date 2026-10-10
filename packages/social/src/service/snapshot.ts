import type { SocialProfileStatus } from "@forgecy/core";
import {
  and,
  desc,
  eq,
  gte,
  socialEdges,
  socialEvents,
  socialPosts,
  socialProfiles,
  socialSnapshots,
  sql,
  type Database,
} from "@forgecy/db";
import { diffProfiles } from "../diff";
import { extractEdges, reconcileEdges, type EdgeKind, type StoredEdge } from "../edges";
import { SourceError } from "../types";
import type {
  PostSnapshot,
  ProfileData,
  ProfileSnapshot,
  SnapshotSource,
  SourceFailure,
} from "../types";
import {
  postFromRow,
  postToInsert,
  profileFromJson,
  SNAPSHOT_SCHEMA_VERSION,
  type ProfileRow,
} from "./rows";
import type { LiveSource, SocialRuntime } from "./runtime";
import { blockedSources, markSourceBlocked } from "./state";

export interface SnapshotDeps {
  db: Database;
  runtime: SocialRuntime;
  now?: () => Date;
  random?: () => number;
}

/** Message keys (namespace `social.status`) stored with a profile that could not be read. */
export type StatusReasonKey =
  | "social.status.blocked"
  | "social.status.apiDrift"
  | "social.status.transport"
  | "social.status.rateLimited"
  | "social.status.private"
  | "social.status.notFound"
  | "social.status.unauthorized"
  | "social.status.noSource";

export type SnapshotOutcome =
  | { status: "ok"; source: SnapshotSource; posts: number; events: number }
  | {
      status: Exclude<SocialProfileStatus, "ok" | "pending">;
      source: SnapshotSource | null;
      failure: SourceFailure | "no_source";
      reasonKey: StatusReasonKey;
    };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Posts already stored are re-read this far back so their likes and comments stay current. */
const REFRESH_WINDOW_MS = 14 * DAY;
/** Edges are rebuilt from the posts of this window. */
const EDGE_WINDOW_MS = 90 * DAY;
const FETCH_LIMIT = 50;
const ANALYSIS_POSTS = 120;

const reasonOf: Record<SourceFailure, StatusReasonKey> = {
  blocked: "social.status.blocked",
  api_drift: "social.status.apiDrift",
  transport: "social.status.transport",
  rate_limited: "social.status.rateLimited",
  private: "social.status.private",
  not_found: "social.status.notFound",
  unauthorized: "social.status.unauthorized",
  disabled: "social.status.noSource",
};

/** What each failure does to the profile, and when it is worth trying again. */
function planFor(failure: SourceFailure): {
  status: Exclude<SocialProfileStatus, "ok" | "pending">;
  retryAfterMs: number | null;
} {
  switch (failure) {
    case "blocked":
      return { status: "blocked", retryAfterMs: null };
    case "private":
    case "not_found":
      // Nothing to read until a person says otherwise ("Try again").
      return { status: "paused", retryAfterMs: null };
    case "transport":
    case "rate_limited":
      return { status: "error", retryAfterMs: HOUR };
    case "api_drift":
      return { status: "error", retryAfterMs: 6 * HOUR };
    default:
      // Token refused, no source: a slow retry, so it does not come due on every scheduler tick.
      return { status: "error", retryAfterMs: 6 * HOUR };
  }
}

function pickSource(
  profile: ProfileRow,
  available: LiveSource[],
  blocked: Partial<Record<LiveSource, string>>,
): LiveSource | null {
  const usable = available.filter((s) => !blocked[s]);
  if (profile.preferredSource && profile.preferredSource !== "file_import") {
    return usable.includes(profile.preferredSource) ? profile.preferredSource : null;
  }
  return usable[0] ?? null;
}

function nextRun(
  profile: ProfileRow,
  now: Date,
  afterMs: number | null,
  rand: number,
): Date | null {
  if (!profile.monitored) return null;
  const base = afterMs ?? profile.intervalHours * HOUR;
  // ±10% so profiles added together do not all come due in the same minute.
  return new Date(now.getTime() + Math.round(base * (0.9 + 0.2 * rand)));
}

async function fail(
  deps: SnapshotDeps,
  profile: ProfileRow,
  source: SnapshotSource | null,
  failure: SourceFailure | "no_source",
  now: Date,
): Promise<SnapshotOutcome> {
  const reasonKey = failure === "no_source" ? "social.status.noSource" : reasonOf[failure];
  const plan = failure === "no_source" ? planFor("disabled") : planFor(failure);
  await deps.db
    .update(socialProfiles)
    .set({
      status: plan.status,
      statusReason: { key: reasonKey },
      nextRunAt:
        plan.retryAfterMs === null
          ? null
          : nextRun(profile, now, plan.retryAfterMs, (deps.random ?? Math.random)()),
    })
    .where(eq(socialProfiles.id, profile.id));
  return { status: plan.status, source, failure, reasonKey };
}

/** Posts the profile has stored, newest first. */
async function storedPosts(
  db: Database,
  profileId: string,
  limit: number,
): Promise<PostSnapshot[]> {
  const rows = await db
    .select()
    .from(socialPosts)
    .where(eq(socialPosts.profileId, profileId))
    .orderBy(desc(socialPosts.postedAt))
    .limit(limit);
  return rows.map(postFromRow);
}

async function latestProfile(db: Database, profileId: string): Promise<ProfileSnapshot | null> {
  const [row] = await db
    .select({ profile: socialSnapshots.profile })
    .from(socialSnapshots)
    .where(eq(socialSnapshots.profileId, profileId))
    .orderBy(desc(socialSnapshots.observedAt))
    .limit(1);
  return row ? profileFromJson(row.profile) : null;
}

/**
 * One read of one profile: fetch from the best source, keep the snapshot and the posts, log what
 * changed since the last read, rebuild the relationship edges and schedule the next run.
 * Failures are recorded on the profile, never thrown, except that a challenge from Instagram
 * also stops the whole source until a person resumes it.
 */
export async function runSnapshot(
  deps: SnapshotDeps,
  profileId: string,
): Promise<SnapshotOutcome | null> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const rand = (deps.random ?? Math.random)();
  const [profile] = await db.select().from(socialProfiles).where(eq(socialProfiles.id, profileId));
  if (!profile || profile.status === "paused") return null;

  const sourceId = pickSource(profile, deps.runtime.available(), await blockedSources(db));
  if (!sourceId) {
    const blocked = Object.keys(await blockedSources(db)).length > 0;
    return fail(deps, profile, null, blocked ? "blocked" : "no_source", now);
  }
  const source = deps.runtime.open(sourceId);
  if (!source) return fail(deps, profile, sourceId, "no_source", now);

  let data: ProfileData;
  try {
    data = await source.fetchProfile(profile.handle, {
      since: profile.latestPostAt
        ? new Date(profile.latestPostAt.getTime() - REFRESH_WINDOW_MS).toISOString()
        : null,
      limit: FETCH_LIMIT,
    });
  } catch (err) {
    const failure = err instanceof SourceError ? err.failure : "transport";
    // Only a challenge or login wall stops the whole source; a refused token is fixed in .env.
    if (failure === "blocked") await markSourceBlocked(db, sourceId, now);
    return fail(deps, profile, sourceId, failure, now);
  }

  const previousProfile = await latestProfile(db, profile.id);
  const previousPosts = await storedPosts(db, profile.id, FETCH_LIMIT);
  const events = diffProfiles(
    previousProfile ? { profile: previousProfile, posts: previousPosts } : null,
    data,
  );

  await db.transaction(async (tx) => {
    await tx.insert(socialSnapshots).values({
      profileId: profile.id,
      source: data.profile.source,
      observedAt: new Date(data.profile.observedAt),
      profile: data.profile as unknown as Record<string, unknown>,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      postCount: data.posts.length,
    });

    for (const post of data.posts) {
      await tx
        .insert(socialPosts)
        .values(postToInsert(profile.id, post, data.profile.source, now))
        .onConflictDoUpdate({
          target: [socialPosts.profileId, socialPosts.postId],
          set: {
            caption: sql`excluded.caption`,
            likes: sql`excluded.likes`,
            comments: sql`excluded.comments`,
            views: sql`excluded.views`,
            hashtags: sql`excluded.hashtags`,
            mentions: sql`excluded.mentions`,
            taggedAccounts: sql`excluded.tagged_accounts`,
            collaborators: sql`excluded.collaborators`,
            isSponsored: sql`excluded.is_sponsored`,
            isPinned: sql`excluded.is_pinned`,
            accessibilityCaption: sql`excluded.accessibility_caption`,
            source: sql`excluded.source`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        });
    }

    if (events.length) {
      await tx.insert(socialEvents).values(
        events.map((e) => ({
          profileId: profile.id,
          at: now,
          type: e.type,
          old: e.old,
          new: e.new,
          postId: e.postId ?? null,
        })),
      );
    }

    // Edges come from the posts we hold, so a quiet run does not end relationships.
    const coveredFrom = new Date(now.getTime() - EDGE_WINDOW_MS);
    const windowPosts = (
      await tx
        .select()
        .from(socialPosts)
        .where(and(eq(socialPosts.profileId, profile.id), gte(socialPosts.postedAt, coveredFrom)))
    ).map(postFromRow);
    const existing: StoredEdge[] = (
      await tx.select().from(socialEdges).where(eq(socialEdges.profileId, profile.id))
    ).map((e) => ({
      src: profile.handle,
      dst: e.dst,
      kind: e.kind as EdgeKind,
      count: e.count,
      firstSeen: e.firstSeen.toISOString(),
      lastSeen: e.lastSeen.toISOString(),
      postIds: e.postIds,
      endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    }));
    const { upserts, ended } = reconcileEdges(existing, extractEdges(profile.handle, windowPosts), {
      now: now.toISOString(),
      coveredFrom: coveredFrom.toISOString(),
    });
    for (const edge of upserts) {
      const values = {
        profileId: profile.id,
        dst: edge.dst,
        kind: edge.kind,
        count: edge.count,
        firstSeen: new Date(edge.firstSeen),
        lastSeen: new Date(edge.lastSeen),
        endedAt: edge.endedAt ? new Date(edge.endedAt) : null,
        postIds: edge.postIds,
      };
      await tx
        .insert(socialEdges)
        .values(values)
        .onConflictDoUpdate({
          target: [socialEdges.profileId, socialEdges.dst, socialEdges.kind],
          set: {
            count: values.count,
            firstSeen: values.firstSeen,
            lastSeen: values.lastSeen,
            endedAt: values.endedAt,
            postIds: values.postIds,
          },
        });
    }
    for (const edge of ended) {
      await tx
        .update(socialEdges)
        .set({ endedAt: new Date(edge.endedAt ?? now.toISOString()) })
        .where(
          and(
            eq(socialEdges.profileId, profile.id),
            eq(socialEdges.dst, edge.dst),
            eq(socialEdges.kind, edge.kind),
          ),
        );
    }

    const newest = data.posts.reduce<Date | null>((acc, p) => {
      const at = new Date(p.postedAt);
      return !acc || at > acc ? at : acc;
    }, profile.latestPostAt);
    const isPrivate = data.profile.isPrivate === true;
    await tx
      .update(socialProfiles)
      .set({
        status: isPrivate ? "paused" : "ok",
        statusReason: isPrivate ? { key: "social.status.private" } : null,
        lastSnapshotAt: now,
        latestPostAt: newest,
        nextRunAt: isPrivate ? null : nextRun(profile, now, null, rand),
      })
      .where(eq(socialProfiles.id, profile.id));
  });

  if (data.profile.isPrivate === true)
    return {
      status: "paused",
      source: data.profile.source,
      failure: "private",
      reasonKey: "social.status.private",
    };
  return {
    status: "ok",
    source: data.profile.source,
    posts: data.posts.length,
    events: events.length,
  };
}

export { ANALYSIS_POSTS, latestProfile, storedPosts };
