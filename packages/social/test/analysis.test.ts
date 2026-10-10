import { describe, expect, it } from "vitest";
import { analyzeProfile } from "../src/analysis/profile";
import { cadence } from "../src/analysis/cadence";
import { captionStats } from "../src/analysis/captions";
import { engagement } from "../src/analysis/engagement";
import { hashtagStats } from "../src/analysis/hashtags";
import { contentMix } from "../src/analysis/mix";
import { tagging } from "../src/analysis/tagging";
import type { PostSnapshot, ProfileData } from "../src/types";

function post(over: Partial<PostSnapshot> & { id: string }): PostSnapshot {
  return {
    shortcode: null,
    postedAt: "2025-01-06T10:00:00Z", // a Monday
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

describe("empty input", () => {
  it("never throws and returns zeros/nulls", () => {
    const now = new Date("2025-02-01T00:00:00Z");
    expect(contentMix([]).total).toBe(0);
    expect(contentMix([]).byKind.reel).toEqual({ count: 0, share: 0, avgInteractions: null });
    expect(contentMix([]).avgCarouselSlides).toBeNull();
    expect(hashtagStats([])).toEqual({
      postsWithHashtags: 0,
      avgPerPost: null,
      distinct: 0,
      top: [],
    });
    const c = cadence([], { timeZone: "UTC", now });
    expect(c.postsPerWeek).toBeNull();
    expect(c.lastPostAt).toBeNull();
    expect(c.daysSinceLastPost).toBeNull();
    expect(c.heatmap).toHaveLength(7);
    expect(c.bestSlots).toEqual([]);
    expect(engagement([], 100)).toMatchObject({
      postsWithMetrics: 0,
      likes: null,
      ratePct: null,
      top: [],
    });
    expect(captionStats([])).toMatchObject({
      postsWithCaption: 0,
      avgLength: null,
      ctaShare: null,
      language: "unknown",
    });
    expect(tagging([])).toEqual({ tagged: [], mentioned: [], collaborators: [] });
  });
});

describe("contentMix", () => {
  it("counts kinds, shares, sponsored, collabs and carousel slides", () => {
    const m = contentMix([
      post({ id: "1", kind: "image", likes: 10, comments: 0 }),
      post({ id: "2", kind: "image", likes: 20, comments: 10, isSponsored: true }),
      post({ id: "3", kind: "carousel", carouselCount: 4, collaborators: ["x"] }),
      post({ id: "4", kind: "carousel", carouselCount: 6 }),
    ]);
    expect(m.total).toBe(4);
    expect(Object.keys(m.byKind).sort()).toEqual(["carousel", "image", "reel", "video"]);
    expect(m.byKind.image).toEqual({ count: 2, share: 0.5, avgInteractions: 20 });
    expect(m.byKind.carousel.avgInteractions).toBeNull();
    expect(m.byKind.video.count).toBe(0);
    expect(m.sponsoredShare).toBe(0.25);
    expect(m.collabShare).toBe(0.25);
    expect(m.avgCarouselSlides).toBe(5);
  });
});

describe("hashtagStats", () => {
  const posts = [
    post({ id: "1", hashtags: ["b", "a"], likes: 10, comments: 0 }),
    post({ id: "2", hashtags: ["b"], likes: 30, comments: 0 }),
    post({ id: "3", hashtags: ["c", "b"] }),
    post({ id: "4" }),
  ];

  it("ranks by count then tag and averages interactions where known", () => {
    const h = hashtagStats(posts);
    expect(h.postsWithHashtags).toBe(3);
    expect(h.avgPerPost).toBe(5 / 4);
    expect(h.distinct).toBe(3);
    expect(h.top).toEqual([
      { tag: "b", count: 3, avgInteractions: 20 },
      { tag: "a", count: 1, avgInteractions: 10 },
      { tag: "c", count: 1, avgInteractions: null },
    ]);
  });

  it("honours topN", () => {
    expect(hashtagStats(posts, 1).top.map((t) => t.tag)).toEqual(["b"]);
  });
});

describe("cadence", () => {
  const now = new Date("2025-01-20T12:00:00Z");

  it("computes the heatmap in the requested time zone", () => {
    const p = [post({ id: "1", postedAt: "2025-01-06T23:30:00Z" })];
    const utc = cadence(p, { timeZone: "UTC", now });
    expect(utc.heatmap[0]![23]).toBe(1);
    const rome = cadence(p, { timeZone: "Europe/Rome", now });
    expect(rome.heatmap[1]![0]).toBe(1); // Tuesday 00:30 in Rome
    expect(rome.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(1);
    expect(rome.timeZone).toBe("Europe/Rome");
  });

  it("leaves day-precision posts out of the heatmap and best slots but not out of the rest", () => {
    const posts = [
      post({ id: "a", postedAt: "2025-01-13T12:00:00Z", postedAtPrecision: "day" }),
      post({ id: "b", postedAt: "2025-01-07T09:15:00Z", postedAtPrecision: "time" }),
      post({ id: "c", postedAt: "2025-01-06T12:00:00Z", postedAtPrecision: "day" }),
      post({ id: "d", postedAt: "2025-01-06T18:00:00Z" }), // no precision counts as exact
    ];
    const c = cadence(posts, { timeZone: "UTC", now });
    expect(c.heatmap.flat().reduce((x, y) => x + y, 0)).toBe(2);
    expect(c.heatmap[1]![9]).toBe(1);
    expect(c.heatmap[0]![18]).toBe(1);
    expect(c.heatmap[0]![12]).toBe(0);
    expect(c.bestSlots).toEqual([
      { weekday: 0, hour: 18, count: 1 },
      { weekday: 1, hour: 9, count: 1 },
    ]);
    // Rate, gaps and last post still use all four posts.
    expect(c.lastPostAt).toBe("2025-01-13T12:00:00Z");
    expect(c.postsPerWeek).toBeCloseTo(3, 5);
    expect(c.medianGapHours).toBeCloseTo(15.25, 5);
  });

  it("gives null rate and gap with a single post, and floors days since", () => {
    const c = cadence([post({ id: "1", postedAt: "2025-01-18T13:00:00Z" })], {
      timeZone: "UTC",
      now,
    });
    expect(c.postsPerWeek).toBeNull();
    expect(c.medianGapHours).toBeNull();
    expect(c.lastPostAt).toBe("2025-01-18T13:00:00Z");
    expect(c.daysSinceLastPost).toBe(1);
  });

  it("clamps daysSinceLastPost at 0 for a future post", () => {
    const c = cadence([post({ id: "1", postedAt: "2025-02-01T00:00:00Z" })], {
      timeZone: "UTC",
      now,
    });
    expect(c.daysSinceLastPost).toBe(0);
  });

  it("uses a 7-day minimum span and the median of consecutive gaps", () => {
    // Newest first: gaps of 24h and 48h over a 3-day span (clamped to 7 days).
    const c = cadence(
      [
        post({ id: "3", postedAt: "2025-01-09T10:00:00Z" }),
        post({ id: "2", postedAt: "2025-01-08T10:00:00Z" }),
        post({ id: "1", postedAt: "2025-01-06T10:00:00Z" }),
      ],
      { timeZone: "UTC", now },
    );
    expect(c.postsPerWeek).toBe(2);
    expect(c.medianGapHours).toBe(36);
  });

  it("uses the real span when longer than 7 days", () => {
    const c = cadence(
      [
        post({ id: "2", postedAt: "2025-01-20T10:00:00Z" }),
        post({ id: "1", postedAt: "2025-01-06T10:00:00Z" }),
      ],
      { timeZone: "UTC", now },
    );
    expect(c.postsPerWeek).toBe(0.5); // 1 gap over 14 days
  });

  it("orders best slots by count, then weekday, then hour, max 5", () => {
    const posts = [
      post({ id: "a", postedAt: "2025-01-07T09:00:00Z" }), // Tue 9
      post({ id: "b", postedAt: "2025-01-14T09:00:00Z" }), // Tue 9
      post({ id: "c", postedAt: "2025-01-06T18:00:00Z" }), // Mon 18
      post({ id: "d", postedAt: "2025-01-06T08:00:00Z" }), // Mon 8
      post({ id: "e", postedAt: "2025-01-08T08:00:00Z" }), // Wed 8
      post({ id: "f", postedAt: "2025-01-09T08:00:00Z" }), // Thu 8
      post({ id: "g", postedAt: "2025-01-10T08:00:00Z" }), // Fri 8
    ];
    const { bestSlots } = cadence(posts, { timeZone: "UTC", now });
    expect(bestSlots).toHaveLength(5);
    expect(bestSlots[0]).toEqual({ weekday: 1, hour: 9, count: 2 });
    expect(bestSlots.slice(1).map((s) => [s.weekday, s.hour])).toEqual([
      [0, 8],
      [0, 18],
      [2, 8],
      [3, 8],
    ]);
  });
});

describe("engagement", () => {
  const posts = [
    post({
      id: "1",
      postedAt: "2025-01-01T00:00:00Z",
      likes: 10,
      comments: 0,
      caption: "x".repeat(200),
    }),
    post({ id: "2", postedAt: "2025-01-02T00:00:00Z", likes: 30, comments: 10 }),
    post({ id: "3", postedAt: "2025-01-03T00:00:00Z", likes: 10, comments: 0 }),
    post({ id: "4", postedAt: "2025-01-04T00:00:00Z", likes: 100, comments: null }), // excluded
    post({ id: "5", postedAt: "2025-01-05T00:00:00Z", likes: 5, comments: 5 }),
  ];

  it("summarises only posts with both metrics", () => {
    const e = engagement(posts, 1000);
    expect(e.postsWithMetrics).toBe(4);
    expect(e.likes).toEqual({ min: 5, max: 30, mean: 13.75, median: 10 });
    expect(e.comments).toEqual({ min: 0, max: 10, mean: 3.75, median: 2.5 });
    expect(e.interactions).toEqual({ min: 10, max: 40, mean: 17.5, median: 10 });
    expect(e.ratePct).toBeCloseTo(1.75);
    expect(e.medianRatePct).toBeCloseTo(1);
  });

  it("returns top and bottom with newer-first ties and a 120-char caption start", () => {
    const e = engagement(posts, 1000, 2);
    expect(e.top.map((r) => r.id)).toEqual(["2", "5"]);
    expect(e.bottom.map((r) => r.id)).toEqual(["5", "3"]); // 1, 5 and 3 tie at 10: newer first
    expect(e.top[0]).toMatchObject({ interactions: 40, postedAt: "2025-01-02T00:00:00Z" });
    const first = engagement(posts, 1000, 10).bottom.at(-1)!;
    expect(first.id).toBe("2");
    expect(engagement(posts, 1000, 10).bottom.find((r) => r.id === "1")!.captionStart).toHaveLength(
      120,
    );
    expect(engagement(posts, 1000).top).toHaveLength(3);
  });

  it("has no rate without followers", () => {
    expect(engagement(posts, null).ratePct).toBeNull();
    expect(engagement(posts, 0).medianRatePct).toBeNull();
    expect(engagement([post({ id: "x", likes: 3 })], 100).ratePct).toBeNull();
  });
});

describe("captionStats", () => {
  it("measures length, CTA, question and emoji shares", () => {
    const c = captionStats([
      post({ id: "1", caption: "Scopri il nuovo menu, link in bio" }),
      post({ id: "2", caption: "Quale preferisci? 😍🔥" }),
      post({ id: "3", caption: "Shop now" }),
      post({ id: "4", caption: "Una giornata normale" }),
      post({ id: "5", caption: null }),
      post({ id: "6", caption: "   " }),
    ]);
    expect(c.postsWithCaption).toBe(4);
    expect(c.ctaShare).toBe(0.5);
    expect(c.questionShare).toBe(0.25);
    expect(c.emojiShare).toBe(0.25);
    expect(c.avgEmojis).toBe(0.5);
    expect(c.avgLength).toBe((33 + 20 + 8 + 20) / 4);
    expect(c.medianLength).toBe(20);
  });

  it("does not count digits as emoji", () => {
    expect(captionStats([post({ id: "1", caption: "Dal 12 al 15" })]).avgEmojis).toBe(0);
  });

  it("detects the language", () => {
    const it1 = post({
      id: "1",
      caption: "Il nostro nuovo prodotto è per tutti, non perdere la sorpresa",
    });
    const en1 = post({ id: "2", caption: "The new product is for you and your friends" });
    expect(captionStats([it1, it1]).language).toBe("it");
    expect(captionStats([en1, en1]).language).toBe("en");
    expect(captionStats([it1, en1]).language).toBe("mixed");
    expect(captionStats([post({ id: "3", caption: "🔥🔥" })]).language).toBe("unknown");
  });
});

describe("tagging", () => {
  it("counts each handle once per post and sorts by count then handle", () => {
    const t = tagging(
      [
        post({
          id: "1",
          taggedAccounts: ["zed", "amy", "zed"],
          mentions: ["bob"],
          collaborators: ["c1"],
        }),
        post({ id: "2", taggedAccounts: ["zed"], mentions: ["bob", "al"] }),
        post({ id: "3", taggedAccounts: ["amy"] }),
      ],
      2,
    );
    expect(t.tagged).toEqual([
      { handle: "amy", count: 2 },
      { handle: "zed", count: 2 },
    ]);
    expect(t.mentioned).toEqual([
      { handle: "bob", count: 2 },
      { handle: "al", count: 1 },
    ]);
    expect(t.collaborators).toEqual([{ handle: "c1", count: 1 }]);
  });
});

describe("analyzeProfile", () => {
  const data: ProfileData = {
    profile: {
      handle: "brand",
      fullName: null,
      biography: null,
      externalUrl: null,
      category: null,
      isBusiness: null,
      isVerified: null,
      isPrivate: null,
      followers: 1000,
      following: null,
      postsTotal: null,
      pictureHash: null,
      observedAt: "2025-01-20T00:00:00Z",
      source: "public_web",
    },
    posts: [
      post({
        id: "new",
        postedAt: "2025-01-18T10:00:00Z",
        likes: 10,
        comments: 0,
        hashtags: ["a"],
      }),
      post({
        id: "old",
        postedAt: "2025-01-04T10:00:00Z",
        likes: 20,
        comments: 10,
        hashtags: ["a", "b"],
      }),
    ],
  };

  it("composes every section and fills the basis", () => {
    const a = analyzeProfile(data, { now: new Date("2025-01-20T10:00:00Z") });
    expect(a.handle).toBe("brand");
    expect(a.followers).toBe(1000);
    expect(a.basis).toEqual({
      postsUsed: 2,
      from: "2025-01-04T10:00:00Z",
      to: "2025-01-18T10:00:00Z",
      source: "public_web",
      observedAt: "2025-01-20T00:00:00Z",
    });
    expect(a.mix.total).toBe(2);
    expect(a.hashtags.top[0]).toMatchObject({ tag: "a", count: 2 });
    expect(a.cadence.timeZone).toBe("UTC");
    expect(a.cadence.daysSinceLastPost).toBe(2);
    expect(a.engagement.ratePct).toBeCloseTo(2);
    expect(a.captions.postsWithCaption).toBe(0);
    expect(a.tagging.tagged).toEqual([]);
  });

  it("handles a profile without posts", () => {
    const a = analyzeProfile({ ...data, posts: [] }, { now: new Date("2025-01-20T10:00:00Z") });
    expect(a.basis).toMatchObject({ postsUsed: 0, from: null, to: null });
    expect(a.engagement.ratePct).toBeNull();
  });
});
