import { assertCan, type Actor } from "@forgecy/core";
import {
  asc,
  desc,
  eq,
  socialEdges,
  socialEvents,
  socialPosts,
  socialProfiles,
  sql,
  type Database,
} from "@forgecy/db";
import { analyzeProfile } from "../analysis/profile";
import type { ProfileAnalysis } from "../analysis/types";
import { buildBenchmark, type BenchmarkTable } from "../benchmark";
import type { EdgeKind } from "../edges";
import type { ProfileSnapshot } from "../types";
import { loadProfile } from "./profiles";
import type { ProfileRow } from "./rows";
import { postFromRow } from "./rows";
import { ANALYSIS_POSTS, latestProfile } from "./snapshot";
import { blockedSources } from "./state";
import type { LiveSource, SocialRuntime } from "./runtime";

export interface ProfileListItem {
  profile: ProfileRow;
  snapshot: ProfileSnapshot | null;
  postsStored: number;
}

export interface AnalysisOptions {
  timeZone?: string;
  now?: Date;
}

/** The profiles followed for a client with their latest numbers. */
export async function listClientProfiles(
  db: Database,
  actor: Actor,
  clientId: string,
): Promise<ProfileListItem[]> {
  assertCan(actor, "view", clientId);
  const rows = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.clientId, clientId))
    .orderBy(asc(socialProfiles.role), asc(socialProfiles.handle));
  const counts = await db
    .select({ profileId: socialPosts.profileId, n: sql<number>`count(*)::int` })
    .from(socialPosts)
    .innerJoin(socialProfiles, eq(socialProfiles.id, socialPosts.profileId))
    .where(eq(socialProfiles.clientId, clientId))
    .groupBy(socialPosts.profileId);
  const byProfile = new Map(counts.map((c) => [c.profileId, c.n]));
  return Promise.all(
    rows.map(async (profile) => ({
      profile,
      snapshot: await latestProfile(db, profile.id),
      postsStored: byProfile.get(profile.id) ?? 0,
    })),
  );
}

export interface ProfileEvent {
  id: string;
  at: Date;
  type: string;
  old: string | null;
  new: string | null;
  postId: string | null;
}

export interface ProfileEdge {
  dst: string;
  kind: EdgeKind;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  endedAt: Date | null;
}

export interface ProfileDetail {
  profile: ProfileRow;
  snapshot: ProfileSnapshot | null;
  analysis: ProfileAnalysis | null;
  events: ProfileEvent[];
  edges: ProfileEdge[];
}

async function analysisFor(
  db: Database,
  profile: ProfileRow,
  snapshot: ProfileSnapshot | null,
  options: AnalysisOptions,
): Promise<ProfileAnalysis | null> {
  if (!snapshot) return null;
  const posts = (
    await db
      .select()
      .from(socialPosts)
      .where(eq(socialPosts.profileId, profile.id))
      .orderBy(desc(socialPosts.postedAt))
      .limit(ANALYSIS_POSTS)
  ).map(postFromRow);
  return analyzeProfile(
    { profile: snapshot, posts },
    {
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      ...(options.now ? { now: options.now } : {}),
    },
  );
}

/** Everything the profile page shows: numbers, analysis, change log and relationships. */
export async function loadProfileDetail(
  db: Database,
  actor: Actor,
  profileId: string,
  options: AnalysisOptions = {},
): Promise<ProfileDetail> {
  const profile = await loadProfile(db, profileId);
  assertCan(actor, "view", profile.clientId);
  const snapshot = await latestProfile(db, profile.id);
  const [analysis, events, edges] = await Promise.all([
    analysisFor(db, profile, snapshot, options),
    db
      .select()
      .from(socialEvents)
      .where(eq(socialEvents.profileId, profile.id))
      .orderBy(desc(socialEvents.at))
      .limit(100),
    db
      .select()
      .from(socialEdges)
      .where(eq(socialEdges.profileId, profile.id))
      .orderBy(desc(socialEdges.count)),
  ]);
  return {
    profile,
    snapshot,
    analysis,
    events: events.map((e) => ({
      id: e.id,
      at: e.at,
      type: e.type,
      old: e.old,
      new: e.new,
      postId: e.postId,
    })),
    edges: edges.map((e) => ({
      dst: e.dst,
      kind: e.kind as EdgeKind,
      count: e.count,
      firstSeen: e.firstSeen,
      lastSeen: e.lastSeen,
      endedAt: e.endedAt,
    })),
  };
}

/** The client's own profile against its competitors and prospects, same metrics side by side. */
export async function loadBenchmark(
  db: Database,
  actor: Actor,
  clientId: string,
  options: AnalysisOptions = {},
): Promise<BenchmarkTable> {
  assertCan(actor, "view", clientId);
  const rows = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.clientId, clientId))
    .orderBy(asc(socialProfiles.role), asc(socialProfiles.handle));
  const entries = [];
  for (const profile of rows) {
    const snapshot = await latestProfile(db, profile.id);
    const analysis = await analysisFor(db, profile, snapshot, options);
    if (analysis) entries.push({ handle: profile.handle, role: profile.role, analysis });
  }
  return buildBenchmark(entries);
}

export interface SourceStatus {
  available: LiveSource[];
  /** Sources stopped after a challenge, with the ISO time. An Admin resumes them. */
  blocked: Partial<Record<LiveSource, string>>;
}

export async function sourceStatus(db: Database, runtime: SocialRuntime): Promise<SourceStatus> {
  return { available: runtime.available(), blocked: await blockedSources(db) };
}
