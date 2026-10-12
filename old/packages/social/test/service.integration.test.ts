import type { Actor } from "@forgecy/core";
import {
  auditEvents,
  auditMetrics,
  auditSocialPosts,
  audits,
  clients,
  createDb,
  eq,
  jobs,
  socialEvents,
  socialProfiles,
  users,
  type Database,
} from "@forgecy/db";
import { createQueues, type JobQueues } from "@forgecy/jobs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addProfile,
  enqueueDueSnapshots,
  importProfileToAudit,
  listClientProfiles,
  loadBenchmark,
  loadProfileDetail,
  removeProfile,
  resumeProfile,
  requestSnapshot,
  resumeSource,
  runSnapshot,
  SourceError,
  updateProfile,
  type LiveSource,
  type PostSnapshot,
  type ProfileData,
  type ProfileSource,
  type SocialRuntime,
} from "../src";
import { createCircuitBreaker } from "../src/net/breaker";
import { blockedSources } from "../src/service/state";

const dbUrl = process.env.FORGECY_TEST_DATABASE_URL;
const redisUrl = process.env.FORGECY_TEST_REDIS_URL;

function post(id: string, postedAt: string, extra: Partial<PostSnapshot> = {}): PostSnapshot {
  return {
    id,
    shortcode: id,
    postedAt,
    kind: "image",
    caption: "Pane fresco ogni mattina #forno @partner_shop",
    likes: 40,
    comments: 4,
    views: null,
    hashtags: ["forno"],
    mentions: ["partner_shop"],
    taggedAccounts: [],
    collaborators: [],
    location: null,
    isSponsored: false,
    isPinned: null,
    carouselCount: null,
    accessibilityCaption: null,
    ...extra,
  };
}

function data(handle: string, followers: number, bio: string, posts: PostSnapshot[]): ProfileData {
  return {
    profile: {
      handle,
      fullName: "Forno Test",
      biography: bio,
      externalUrl: null,
      category: null,
      isBusiness: true,
      isVerified: false,
      isPrivate: false,
      followers,
      following: 10,
      postsTotal: posts.length,
      pictureHash: null,
      observedAt: "2026-10-10T08:00:00.000Z",
      source: "graph_api",
    },
    posts,
  };
}

describe.skipIf(!dbUrl || !redisUrl)("social profile analysis (integration)", () => {
  let db: Database;
  let queues: JobQueues;
  let admin: Actor;
  let outsider: Actor;
  let clientId: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  const handle = `forno_${suffix}`;

  // The fake source returns whatever `next` holds, or throws it.
  let next: ProfileData | SourceError;
  const source: ProfileSource = {
    id: "graph_api",
    async fetchProfile() {
      if (next instanceof SourceError) throw next;
      return next;
    },
  };
  const runtime: SocialRuntime = {
    available: () => ["graph_api"] as LiveSource[],
    open: () => source,
    breaker: () => createCircuitBreaker({ failureThreshold: 3, openMs: 1000 }),
  };
  let profileId: string;

  beforeAll(async () => {
    db = createDb(dbUrl!, { max: 2 });
    queues = await createQueues(redisUrl!);
    const [u] = await db
      .insert(users)
      .values({ name: "Test", email: `social-${suffix}@example.test`, isAdmin: true })
      .returning({ id: users.id });
    admin = { type: "user", id: u!.id, isAdmin: true, active: true, clients: "all" };
    outsider = { type: "user", id: u!.id, isAdmin: false, active: true, clients: [] };
    const [c] = await db
      .insert(clients)
      .values({ name: `Forno ${suffix}`, slug: `forno-${suffix}` })
      .returning({ id: clients.id });
    clientId = c!.id;
  });

  afterAll(async () => {
    if (clientId) {
      await db.delete(jobs).where(eq(jobs.clientId, clientId));
      await db.delete(clients).where(eq(clients.id, clientId));
    }
    if (admin?.type === "user") {
      await db.delete(auditEvents).where(eq(auditEvents.actorUserId, admin.id));
      await db.delete(users).where(eq(users.id, admin.id));
    }
    await queues?.close();
  });

  it("accepts links and @names, refuses anything else and duplicates", async () => {
    await expect(
      addProfile({ db }, admin, { clientId, handle: "not a handle!" }),
    ).rejects.toThrow();
    const row = await addProfile({ db }, admin, {
      clientId,
      handle: `https://www.instagram.com/${handle.toUpperCase()}/?hl=it`,
      role: "self",
    });
    profileId = row.id;
    expect(row.handle).toBe(handle);
    await expect(addProfile({ db }, admin, { clientId, handle: `@${handle}` })).rejects.toThrow();
  });

  it("keeps clients apart: nobody reads or edits what is not theirs", async () => {
    await expect(listClientProfiles(db, outsider, clientId)).rejects.toThrow();
    await expect(updateProfile({ db }, outsider, { profileId, monitored: true })).rejects.toThrow();
    await expect(loadProfileDetail(db, outsider, profileId)).rejects.toThrow();
  });

  it("the first read is a baseline: snapshot, posts and edges, no change events", async () => {
    next = data(handle, 100, "Forno artigianale", [
      post("A1", "2026-10-01T09:00:00.000Z", { taggedAccounts: ["partner_shop"] }),
      post("A0", "2026-09-24T09:00:00.000Z"),
    ]);
    const outcome = await runSnapshot(
      { db, runtime, now: () => new Date("2026-10-10T08:00:00Z") },
      profileId,
    );
    expect(outcome).toMatchObject({ status: "ok", posts: 2, events: 0 });
    const detail = await loadProfileDetail(db, admin, profileId, {
      now: new Date("2026-10-10T08:00:00Z"),
    });
    expect(detail.profile.status).toBe("ok");
    expect(detail.profile.latestPostAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(detail.analysis?.mix.total).toBe(2);
    expect(detail.analysis?.basis.source).toBe("graph_api");
    expect(detail.edges.map((e) => `${e.kind}:${e.dst}`).sort()).toEqual([
      "mentions:partner_shop",
      "tags:partner_shop",
    ]);
    expect(detail.events).toHaveLength(0);
  });

  it("the second read logs what changed, once", async () => {
    next = data(handle, 112, "Forno artigianale dal 1970", [
      post("A2", "2026-10-08T09:00:00.000Z"),
      post("A1", "2026-10-01T09:00:00.000Z", { likes: 55, taggedAccounts: ["partner_shop"] }),
      post("A0", "2026-09-24T09:00:00.000Z"),
    ]);
    const outcome = await runSnapshot(
      { db, runtime, now: () => new Date("2026-10-11T08:00:00Z") },
      profileId,
    );
    expect(outcome).toMatchObject({ status: "ok", posts: 3 });
    const events = await db
      .select()
      .from(socialEvents)
      .where(eq(socialEvents.profileId, profileId));
    expect(events.map((e) => e.type).sort()).toEqual([
      "biography",
      "followers",
      "new_post",
      "posts_total",
    ]);
    expect(events.find((e) => e.type === "followers")).toMatchObject({ old: "100", new: "112" });
    // A post that was already stored is updated in place, not duplicated.
    const detail = await loadProfileDetail(db, admin, profileId);
    expect(detail.analysis?.mix.total).toBe(3);
    expect(detail.analysis?.engagement.postsWithMetrics).toBe(3);
  });

  it("builds a benchmark from the stored profiles", async () => {
    const table = await loadBenchmark(db, admin, clientId);
    expect(table.rows.map((r) => r.handle)).toEqual([handle]);
    expect(table.rows[0]?.values.followers).toBe(112);
  });

  it("fills an audit's Instagram channel and replaces it on the next read", async () => {
    const [audit] = await db
      .insert(audits)
      .values({ clientId, status: "collecting" })
      .returning({ id: audits.id });
    const auditId = audit!.id;
    expect(await importProfileToAudit(db, admin, { auditId, profileId })).toEqual({ posts: 3 });
    expect(await importProfileToAudit(db, admin, { auditId, profileId })).toEqual({ posts: 3 });
    const metrics = await db.select().from(auditMetrics).where(eq(auditMetrics.auditId, auditId));
    expect(metrics.map((m) => m.metric).sort()).toEqual(["followers", "posts_total"]);
    expect(metrics.find((m) => m.metric === "followers")).toMatchObject({
      value: 112,
      source: "file_import",
    });
    const rows = await db
      .select()
      .from(auditSocialPosts)
      .where(eq(auditSocialPosts.auditId, auditId));
    expect(rows).toHaveLength(3);
    await expect(importProfileToAudit(db, outsider, { auditId, profileId })).rejects.toThrow();
    await db.update(audits).set({ status: "delivered" }).where(eq(audits.id, auditId));
    await expect(importProfileToAudit(db, admin, { auditId, profileId })).rejects.toThrow();
  });

  it("a challenge from Instagram stops the source until an Admin resumes it", async () => {
    await updateProfile({ db, queues }, admin, { profileId, monitored: true });
    next = new SourceError("blocked", "login wall");
    const outcome = await runSnapshot({ db, runtime }, profileId);
    expect(outcome).toMatchObject({ status: "blocked", failure: "blocked" });
    expect(Object.keys(await blockedSources(db))).toEqual(["graph_api"]);
    const [blocked] = await db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.id, profileId));
    expect(blocked).toMatchObject({ status: "blocked", nextRunAt: null });

    // Nothing is queued while the source is stopped, even with a due profile.
    expect(await enqueueDueSnapshots(db, queues, runtime)).toBe(0);
    await expect(resumeSource({ db }, outsider, "graph_api")).rejects.toThrow();

    await resumeSource({ db }, admin, "graph_api");
    expect(await blockedSources(db)).toEqual({});
    const [resumed] = await db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.id, profileId));
    expect(resumed?.status).toBe("pending");
  });

  it("queues a due read once, staggered, and refuses a second one while it is active", async () => {
    expect(await enqueueDueSnapshots(db, queues, runtime)).toBe(1);
    expect(await enqueueDueSnapshots(db, queues, runtime)).toBe(0);
    await expect(requestSnapshot({ db, queues }, admin, profileId)).rejects.toThrow();
  });

  it("a transient failure is recorded and retried later, not thrown", async () => {
    next = new SourceError("transport", "timeout");
    const outcome = await runSnapshot(
      { db, runtime, now: () => new Date("2026-10-12T08:00:00Z") },
      profileId,
    );
    expect(outcome).toMatchObject({ status: "error", failure: "transport" });
    const [row] = await db.select().from(socialProfiles).where(eq(socialProfiles.id, profileId));
    expect(row?.status).toBe("error");
    expect(row?.nextRunAt && row.nextRunAt > new Date("2026-10-12T08:00:00Z")).toBe(true);
  });

  it("a deleted account pauses instead of coming due on every scheduler tick", async () => {
    await updateProfile({ db }, admin, { profileId, monitored: true });
    next = new SourceError("not_found", "gone");
    const at = new Date("2026-10-13T08:00:00Z");
    expect(await runSnapshot({ db, runtime, now: () => at }, profileId)).toMatchObject({
      status: "paused",
      failure: "not_found",
    });
    expect(await enqueueDueSnapshots(db, queues, runtime, new Date("2026-10-20T08:00:00Z"))).toBe(
      0,
    );
    // A token that is refused retries slowly, not on the next tick.
    await resumeProfile({ db }, admin, profileId);
    next = new SourceError("unauthorized", "bad token");
    await runSnapshot({ db, runtime, now: () => at }, profileId);
    const [row] = await db.select().from(socialProfiles).where(eq(socialProfiles.id, profileId));
    expect(row?.status).toBe("error");
    expect(row?.nextRunAt && row.nextRunAt.getTime() - at.getTime() > 5 * 3_600_000).toBe(true);
  });

  it("removing a profile removes its data", async () => {
    await removeProfile({ db }, admin, profileId);
    const rows = await db.select().from(socialEvents).where(eq(socialEvents.profileId, profileId));
    expect(rows).toHaveLength(0);
  });
});
