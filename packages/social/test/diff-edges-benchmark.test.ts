import { describe, expect, it } from "vitest";
import type { ProfileAnalysis } from "../src/analysis/types";
import { buildBenchmark, type BenchmarkEntry } from "../src/benchmark";
import { diffProfiles, needsPostFetch } from "../src/diff";
import {
  edgeOverlap,
  extractEdges,
  jaccard,
  reconcileEdges,
  type Edge,
  type StoredEdge,
} from "../src/edges";
import type { PostSnapshot, ProfileData, ProfileSnapshot } from "../src/types";

function post(over: Partial<PostSnapshot> & { id: string }): PostSnapshot {
  return {
    shortcode: null,
    postedAt: "2026-01-01T00:00:00Z",
    kind: "image",
    caption: null,
    likes: null,
    comments: null,
    views: null,
    hashtags: [],
    mentions: [],
    taggedAccounts: [],
    collaborators: [],
    location: null,
    isSponsored: false,
    isPinned: null,
    carouselCount: null,
    accessibilityCaption: null,
    ...over,
  };
}

function profile(over: Partial<ProfileSnapshot> = {}): ProfileSnapshot {
  return {
    handle: "brand",
    fullName: "Brand",
    biography: "bio",
    externalUrl: "https://brand.example",
    category: "Shop",
    isBusiness: true,
    isVerified: false,
    isPrivate: false,
    followers: 1000,
    following: 100,
    postsTotal: 10,
    pictureHash: "aaa",
    observedAt: "2026-01-01T00:00:00Z",
    source: "public_web",
    ...over,
  };
}

const data = (p: Partial<ProfileSnapshot> = {}, posts: PostSnapshot[] = []): ProfileData => ({
  profile: profile(p),
  posts,
});

describe("diffProfiles", () => {
  it("returns no events for the first snapshot", () => {
    expect(diffProfiles(null, data())).toEqual([]);
  });

  it("ignores observedAt and identical data", () => {
    expect(diffProfiles(data(), data({ observedAt: "2026-02-01T00:00:00Z" }))).toEqual([]);
  });

  it("renders counts as decimal strings and handles null transitions", () => {
    const events = diffProfiles(
      data({ followers: 1000, following: null, postsTotal: 10 }),
      data({ followers: 1200, following: 90, postsTotal: null }),
    );
    expect(events).toEqual([
      { type: "followers", old: "1000", new: "1200" },
      { type: "following", old: null, new: "90" },
      { type: "posts_total", old: "10", new: null },
    ]);
  });

  it("detects text, category and visibility changes", () => {
    const events = diffProfiles(
      data({ biography: "a", externalUrl: null, fullName: "X", category: "A", isPrivate: false }),
      data({ biography: "b", externalUrl: "u", fullName: "Y", category: null, isPrivate: true }),
    );
    expect(events.map((e) => e.type)).toEqual([
      "biography",
      "external_url",
      "full_name",
      "category",
      "visibility",
    ]);
    expect(events.at(-1)).toEqual({ type: "visibility", old: "public", new: "private" });
  });

  it("renders unknown visibility as null", () => {
    const events = diffProfiles(data({ isPrivate: null }), data({ isPrivate: true }));
    expect(events).toEqual([{ type: "visibility", old: null, new: "private" }]);
  });

  it("compares the picture only when both hashes are known", () => {
    expect(diffProfiles(data({ pictureHash: null }), data({ pictureHash: "b" }))).toEqual([]);
    expect(diffProfiles(data({ pictureHash: "a" }), data({ pictureHash: null }))).toEqual([]);
    expect(diffProfiles(data({ pictureHash: "a" }), data({ pictureHash: "b" }))).toEqual([
      { type: "picture", old: "a", new: "b" },
    ]);
  });

  it("emits a source event when the source changes", () => {
    expect(diffProfiles(data(), data({ source: "graph_api" }))).toEqual([
      { type: "source", old: "public_web", new: "graph_api" },
    ]);
  });

  it("emits new posts newer than the newest known one, oldest first", () => {
    const prev = data({}, [
      post({ id: "p2", postedAt: "2026-01-10T00:00:00Z" }),
      post({ id: "p1", postedAt: "2026-01-05T00:00:00Z" }),
    ]);
    const next = data({}, [
      post({ id: "p4", shortcode: "SC4", postedAt: "2026-01-20T00:00:00Z" }),
      post({ id: "p3", postedAt: "2026-01-15T00:00:00Z" }),
      post({ id: "p2", postedAt: "2026-01-10T00:00:00Z" }),
    ]);
    expect(diffProfiles(prev, next)).toEqual([
      { type: "new_post", old: null, new: "p3", postId: "p3" },
      { type: "new_post", old: null, new: "SC4", postId: "p4" },
    ]);
  });

  it("does not report older posts that merely entered the window", () => {
    const prev = data({}, [post({ id: "p2", postedAt: "2026-01-10T00:00:00Z" })]);
    const next = data({}, [
      post({ id: "p2", postedAt: "2026-01-10T00:00:00Z" }),
      post({ id: "old", postedAt: "2025-12-01T00:00:00Z" }),
    ]);
    expect(diffProfiles(prev, next)).toEqual([]);
  });

  it("does not report a post that is merely missing (deleted)", () => {
    const prev = data({}, [post({ id: "a", postedAt: "2026-01-10T00:00:00Z" })]);
    expect(diffProfiles(prev, data())).toEqual([]);
  });

  it("emits no new_post when the previous snapshot has no posts", () => {
    const next = data({}, [post({ id: "a" })]);
    expect(diffProfiles(data(), next)).toEqual([]);
  });
});

describe("needsPostFetch", () => {
  it("is true without a previous snapshot or with an unknown total", () => {
    expect(needsPostFetch(null, profile())).toBe(true);
    expect(needsPostFetch(profile({ postsTotal: null }), profile())).toBe(true);
    expect(needsPostFetch(profile(), profile({ postsTotal: null }))).toBe(true);
  });

  it("is true only when the total changed", () => {
    expect(needsPostFetch(profile(), profile({ postsTotal: 11 }))).toBe(true);
    expect(needsPostFetch(profile(), profile({ followers: 5 }))).toBe(false);
  });
});

describe("extractEdges", () => {
  const posts = [
    post({
      id: "p1",
      postedAt: "2026-01-03T00:00:00Z",
      taggedAccounts: ["a", "a", "brand"],
      mentions: ["b"],
    }),
    post({
      id: "p2",
      postedAt: "2026-01-01T00:00:00Z",
      taggedAccounts: ["a"],
      collaborators: ["c"],
    }),
    post({ id: "p3", postedAt: "2026-01-02T00:00:00Z", mentions: ["b", "a"] }),
  ];

  it("counts once per post, skips self, and tracks the window", () => {
    const edges = extractEdges("brand", posts);
    expect(edges.map((e) => `${e.kind}:${e.dst}:${e.count}`)).toEqual([
      "tags:a:2",
      "mentions:b:2",
      "mentions:a:1",
      "collab:c:1",
    ]);
    const tagsA = edges[0] as Edge;
    expect(tagsA.firstSeen).toBe("2026-01-01T00:00:00Z");
    expect(tagsA.lastSeen).toBe("2026-01-03T00:00:00Z");
    expect(tagsA.postIds.sort()).toEqual(["p1", "p2"]);
    expect(tagsA.src).toBe("brand");
  });

  it("breaks count ties by destination", () => {
    const edges = extractEdges("brand", [post({ id: "x", mentions: ["zed", "amy"] })]);
    expect(edges.map((e) => e.dst)).toEqual(["amy", "zed"]);
  });

  it("returns nothing for no posts", () => {
    expect(extractEdges("brand", [])).toEqual([]);
  });
});

describe("reconcileEdges", () => {
  const stored = (over: Partial<StoredEdge> = {}): StoredEdge => ({
    src: "brand",
    dst: "a",
    kind: "tags",
    count: 2,
    firstSeen: "2026-01-10T00:00:00Z",
    lastSeen: "2026-01-20T00:00:00Z",
    postIds: ["p1", "p2"],
    endedAt: null,
    ...over,
  });
  const fresh = (over: Partial<Edge> = {}): Edge => {
    const { endedAt: _unused, ...base } = stored();
    return { ...base, ...over };
  };
  const opts = { now: "2026-03-01T00:00:00Z", coveredFrom: "2026-01-01T00:00:00Z" };

  it("inserts brand-new edges as open", () => {
    const r = reconcileEdges([], [fresh()], opts);
    expect(r.upserts).toEqual([stored()]);
    expect(r.ended).toEqual([]);
  });

  it("leaves an identical edge alone", () => {
    expect(reconcileEdges([stored()], [fresh()], opts)).toEqual({ upserts: [], ended: [] });
  });

  it("uses the fresh count when the fresh window reaches back before the stored one", () => {
    const r = reconcileEdges(
      [stored()],
      [fresh({ count: 3, firstSeen: "2026-01-05T00:00:00Z", postIds: ["p0", "p1", "p2"] })],
      opts,
    );
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({
      count: 3,
      firstSeen: "2026-01-05T00:00:00Z",
      postIds: ["p1", "p2", "p0"],
    });
  });

  it("adds only unseen posts when the windows overlap later", () => {
    const r = reconcileEdges(
      [stored()],
      [
        fresh({
          count: 2,
          firstSeen: "2026-01-15T00:00:00Z",
          lastSeen: "2026-02-01T00:00:00Z",
          postIds: ["p2", "p9"],
        }),
      ],
      opts,
    );
    expect(r.upserts[0]).toMatchObject({
      count: 3,
      lastSeen: "2026-02-01T00:00:00Z",
      firstSeen: "2026-01-10T00:00:00Z",
      postIds: ["p1", "p2", "p9"],
    });
  });

  it("reopens an ended edge that is seen again", () => {
    const r = reconcileEdges([stored({ endedAt: "2026-02-01T00:00:00Z" })], [fresh()], opts);
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]?.endedAt).toBeNull();
    expect(r.ended).toEqual([]);
  });

  it("ends an open edge missing from fresh when coverage should have contained it", () => {
    const r = reconcileEdges([stored()], [], opts);
    expect(r.ended).toEqual([stored({ endedAt: opts.now })]);
    expect(r.upserts).toEqual([]);
  });

  it("keeps an edge whose last sighting is before the covered window", () => {
    const old = stored({ lastSeen: "2025-12-01T00:00:00Z", firstSeen: "2025-11-01T00:00:00Z" });
    expect(reconcileEdges([old], [], opts)).toEqual({ upserts: [], ended: [] });
  });

  it("never ends anything when coverage is unknown", () => {
    expect(reconcileEdges([stored()], [], { now: opts.now, coveredFrom: null })).toEqual({
      upserts: [],
      ended: [],
    });
  });

  it("does not end an already ended edge again", () => {
    const e = stored({ endedAt: "2026-02-01T00:00:00Z" });
    expect(reconcileEdges([e], [], opts)).toEqual({ upserts: [], ended: [] });
  });
});

describe("jaccard and edgeOverlap", () => {
  it("handles empty sets, overlap and duplicates", () => {
    expect(jaccard([], [])).toEqual({ jaccard: 0, shared: [] });
    expect(jaccard(["a", "b"], [])).toEqual({ jaccard: 0, shared: [] });
    expect(jaccard(["a", "b", "b"], ["b", "c"])).toEqual({ jaccard: 1 / 3, shared: ["b"] });
  });

  it("compares destination handles, optionally by kind", () => {
    const a = extractEdges("x", [post({ id: "1", taggedAccounts: ["m", "n"], mentions: ["o"] })]);
    const b = extractEdges("y", [post({ id: "2", taggedAccounts: ["n"], mentions: ["m", "o"] })]);
    expect(edgeOverlap(a, b)).toEqual({ jaccard: 1, shared: ["m", "n", "o"] });
    expect(edgeOverlap(a, b, "tags")).toEqual({ jaccard: 1 / 2, shared: ["n"] });
    expect(edgeOverlap(a, b, "collab")).toEqual({ jaccard: 0, shared: [] });
  });
});

describe("buildBenchmark", () => {
  const kind = (share: number) => ({ count: 0, share, avgInteractions: null });
  function analysis(
    handle: string,
    o: {
      followers?: number | null;
      ppw?: number | null;
      rate?: number | null;
      days?: number | null;
      reel?: number;
      cta?: number | null;
      to?: string | null;
      source?: ProfileAnalysis["basis"]["source"];
    } = {},
  ): ProfileAnalysis {
    return {
      handle,
      basis: {
        postsUsed: 10,
        from: "2026-01-01T00:00:00Z",
        to: o.to === undefined ? "2026-03-01T00:00:00Z" : o.to,
        source: o.source ?? "public_web",
        observedAt: "2026-03-02T00:00:00Z",
      },
      followers: o.followers === undefined ? 1000 : o.followers,
      mix: {
        total: 10,
        byKind: {
          image: kind(0.5),
          video: kind(0),
          carousel: kind(0.25),
          reel: kind(o.reel ?? 0.25),
        },
        sponsoredShare: 0.1,
        collabShare: 0,
        avgCarouselSlides: null,
      },
      hashtags: { postsWithHashtags: 5, avgPerPost: 3, distinct: 5, top: [] },
      cadence: {
        postsPerWeek: o.ppw === undefined ? 2 : o.ppw,
        medianGapHours: null,
        lastPostAt: null,
        daysSinceLastPost: o.days === undefined ? 5 : o.days,
        heatmap: [],
        bestSlots: [],
        timeZone: "UTC",
      },
      engagement: {
        postsWithMetrics: 5,
        likes: null,
        comments: null,
        interactions: null,
        ratePct: o.rate === undefined ? 1.5 : o.rate,
        medianRatePct: null,
        top: [],
        bottom: [],
      },
      captions: {
        postsWithCaption: 5,
        avgLength: null,
        medianLength: null,
        ctaShare: o.cta === undefined ? 0.4 : o.cta,
        questionShare: null,
        emojiShare: null,
        avgEmojis: null,
        language: "it",
      },
      tagging: { tagged: [], mentioned: [], collaborators: [] },
    };
  }
  const entry = (
    handle: string,
    role: BenchmarkEntry["role"],
    o?: Parameters<typeof analysis>[1],
  ): BenchmarkEntry => ({ handle, role, analysis: analysis(handle, o) });

  it("ranks with ties, inverts daysSinceLastPost and keeps input order", () => {
    const t = buildBenchmark([
      entry("me", "self", { followers: 1000, days: 5 }),
      entry("c1", "competitor", { followers: 5000, days: 2 }),
      entry("c2", "competitor", { followers: 1000, days: 9 }),
    ]);
    expect(t.rows.map((r) => r.handle)).toEqual(["me", "c1", "c2"]);
    expect(t.rows.map((r) => r.ranks.followers)).toEqual([2, 1, 2]);
    expect(t.rows.map((r) => r.ranks.daysSinceLastPost)).toEqual([2, 1, 3]);
    expect(t.best.followers).toBe("c1");
    expect(t.best.daysSinceLastPost).toBe("c1");
    expect(t.best.engagementRatePct).toBe("me");
  });

  it("reads each metric from the right place", () => {
    const t = buildBenchmark([entry("me", "self", { reel: 0.6, cta: 0.2 })]);
    expect(t.rows[0]?.values).toEqual({
      followers: 1000,
      postsPerWeek: 2,
      engagementRatePct: 1.5,
      avgHashtagsPerPost: 3,
      ctaShare: 0.2,
      reelShare: 0.6,
      carouselShare: 0.25,
      sponsoredShare: 0.1,
      daysSinceLastPost: 5,
    });
  });

  it("gives null values a null rank and never lets them win", () => {
    const t = buildBenchmark([
      entry("me", "self", { rate: null, cta: null }),
      entry("c1", "competitor", { rate: 2 }),
    ]);
    expect(t.rows[0]?.ranks.engagementRatePct).toBeNull();
    expect(t.rows[0]?.ranks.ctaShare).toBeNull();
    expect(t.best.engagementRatePct).toBe("c1");
    const none = buildBenchmark([entry("me", "self", { rate: null })]);
    expect(none.best.engagementRatePct).toBeNull();
  });

  it("computes vsSelf, null when either side is null or there is no self", () => {
    const t = buildBenchmark([
      entry("me", "self", { followers: 1000, rate: null }),
      entry("c1", "competitor", { followers: 1500, rate: 2 }),
    ]);
    expect(t.rows[0]?.vsSelf.followers).toBe(0);
    expect(t.rows[1]?.vsSelf.followers).toBe(500);
    expect(t.rows[1]?.vsSelf.engagementRatePct).toBeNull();

    const noSelf = buildBenchmark([entry("c1", "competitor"), entry("p", "prospect")]);
    expect(noSelf.rows.every((r) => Object.values(r.vsSelf).every((v) => v === null))).toBe(true);
  });

  it("handles an empty list", () => {
    const t = buildBenchmark([]);
    expect(t.rows).toEqual([]);
    expect(t.basisWarning).toBe(false);
    expect(t.best.followers).toBeNull();
  });

  it("warns on mixed sources or windows more than 30 days apart", () => {
    expect(
      buildBenchmark([entry("a", "self"), entry("b", "competitor", { source: "graph_api" })])
        .basisWarning,
    ).toBe(true);
    expect(
      buildBenchmark([
        entry("a", "self", { to: "2026-03-01T00:00:00Z" }),
        entry("b", "competitor", { to: "2026-04-15T00:00:00Z" }),
      ]).basisWarning,
    ).toBe(true);
    expect(
      buildBenchmark([
        entry("a", "self", { to: "2026-03-01T00:00:00Z" }),
        entry("b", "competitor", { to: "2026-03-25T00:00:00Z" }),
        entry("c", "prospect", { to: null }),
      ]).basisWarning,
    ).toBe(false);
  });
});
