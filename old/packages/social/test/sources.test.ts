import { describe, expect, it } from "vitest";
import { endpoints } from "../src/sources/endpoints";
import { createGraphApiSource } from "../src/sources/graph-api";
import { classifyHttp } from "../src/sources/http";
import { SourceError } from "../src/types";
import type { FetchLike, RequestGuard, SourceFailure } from "../src/types";

interface Canned {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(queue: Array<Canned | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("no canned response left");
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body ?? {});
    return {
      status: next.status ?? 200,
      headers: { get: (name: string) => next.headers?.[name.toLowerCase()] ?? null },
      text: async () => text,
    };
  };
  return { fetch, calls };
}

function fakeGuard() {
  const buckets: string[] = [];
  const guard: RequestGuard = {
    run: (bucket, fn) => {
      buckets.push(bucket);
      return fn();
    },
  };
  return { guard, buckets };
}

async function failureOf(p: Promise<unknown>): Promise<SourceError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(SourceError);
    return err as SourceError;
  }
  throw new Error("expected a SourceError");
}

const NOW = new Date("2025-06-01T12:00:00.000Z");
const TOKEN = "TOKEN_abc123_SECRET";

describe("classifyHttp", () => {
  const table: Array<[number, string, string | null | undefined, SourceFailure | null]> = [
    [429, "", undefined, "rate_limited"],
    [404, "", undefined, "not_found"],
    [401, "", undefined, "unauthorized"],
    [403, "{}", undefined, "unauthorized"],
    [403, '{"message":"feedback_required"}', undefined, "blocked"],
    [400, '{"message":"checkpoint_required"}', undefined, "blocked"],
    [400, '{"message":"challenge_required"}', undefined, "blocked"],
    [403, '{"message":"login_required"}', undefined, "blocked"],
    [400, '{"require_login":true}', undefined, "blocked"],
    [403, '{"require_login": true}', undefined, "blocked"],
    [400, '{"require_login":false}', undefined, null],
    [400, "{}", undefined, null],
    // The wall wins over the status it comes with, and a 200 can be the wall too.
    [401, '{"require_login":true}', undefined, "blocked"],
    [429, '{"message":"login_required"}', undefined, "blocked"],
    [200, '{"require_login": true}', undefined, "blocked"],
    [200, '{"data":{"user":{"biography":"say \\"require_login\\":true"}}}', undefined, null],
    [302, "", "https://www.instagram.com/accounts/login/?next=/x", "blocked"],
    [302, "", "https://www.instagram.com/challenge/?next=/x", "blocked"],
    [302, "", "https://www.instagram.com/other/", null],
    [302, "", null, null],
    [500, "", undefined, "transport"],
    [503, "", undefined, "transport"],
    [0, "", undefined, "transport"],
    [200, "", undefined, null],
    [204, "", undefined, null],
    [418, "", undefined, null],
  ];
  it.each(table)("%i %s %s -> %s", (status, body, location, expected) => {
    expect(classifyHttp(status, body, location)).toBe(expected);
  });
});

describe("graph api source", () => {
  const page1 = {
    business_discovery: {
      username: "Acme_Bakery",
      name: "Acme Bakery",
      biography: "Fresh bread daily",
      website: "https://acme-bakery.example",
      followers_count: 1200,
      follows_count: 80,
      media_count: 342,
      profile_picture_url: "https://cdn.example/pic.jpg",
      media: {
        data: [
          {
            id: "m3",
            caption: "Sourdough day #Bread #bread with @acme_farm",
            timestamp: "2025-05-30T08:00:00+0000",
            media_type: "CAROUSEL_ALBUM",
            media_product_type: "FEED",
            like_count: 55,
            comments_count: 4,
            permalink: "https://www.instagram.com/p/CODE3/",
            children: {
              data: [{ media_type: "IMAGE" }, { media_type: "IMAGE" }, { media_type: "VIDEO" }],
            },
          },
          {
            id: "m2",
            caption: "Behind the oven",
            timestamp: "2025-05-28T08:00:00+0000",
            media_type: "VIDEO",
            media_product_type: "REELS",
            comments_count: 9,
            permalink: "https://www.instagram.com/reel/CODE2/",
          },
        ],
        paging: {
          cursors: { after: "CUR1" },
          next: `${endpoints.graphApiBase}/v99.0/IGID?after=CUR1&access_token=${TOKEN}`,
        },
      },
    },
    id: "IGID",
  };
  const page2 = {
    business_discovery: {
      username: "acme_bakery",
      media: {
        data: [
          {
            id: "m1",
            timestamp: "2025-05-20T08:00:00+0000",
            media_type: "IMAGE",
            media_product_type: "FEED",
            like_count: 10,
            comments_count: 1,
            permalink: "https://www.instagram.com/p/CODE1/",
          },
          {
            id: "m0",
            timestamp: "2025-05-10T08:00:00+0000",
            media_type: "VIDEO",
            media_product_type: "FEED",
            like_count: 3,
            comments_count: 0,
            permalink: "https://www.instagram.com/p/CODE0/",
          },
        ],
      },
    },
  };

  function make(queue: Array<Canned | Error>, extra: { pageSize?: number } = {}) {
    const f = fakeFetch(queue);
    const g = fakeGuard();
    const source = createGraphApiSource({
      fetch: f.fetch,
      guard: g.guard,
      accessToken: TOKEN,
      igUserId: "IGID",
      now: () => NOW,
      ...extra,
    });
    return { source, ...f, ...g };
  }

  it("builds the Business Discovery request and maps every field", async () => {
    const { source, calls, buckets } = make([
      {
        body: {
          ...page1,
          business_discovery: {
            ...page1.business_discovery,
            media: { data: page1.business_discovery.media.data },
          },
        },
      },
    ]);
    const data = await source.fetchProfile("@Acme_Bakery");

    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe(
      `${endpoints.graphApiBase}/${endpoints.graphApiVersion}/IGID`,
    );
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    const fields = url.searchParams.get("fields")!;
    expect(fields).toContain("business_discovery.username(acme_bakery){username,name,biography");
    expect(fields).toContain("media.limit(50){id,caption,timestamp,media_type,media_product_type");
    expect(fields).toContain("children{media_type}");
    expect(buckets).toEqual(["graph_api"]);
    expect(source.id).toBe("graph_api");

    expect(data.profile).toEqual({
      handle: "acme_bakery",
      fullName: "Acme Bakery",
      biography: "Fresh bread daily",
      externalUrl: "https://acme-bakery.example",
      category: null,
      isBusiness: true,
      isVerified: null,
      isPrivate: false,
      followers: 1200,
      following: 80,
      postsTotal: 342,
      pictureHash: null,
      observedAt: "2025-06-01T12:00:00.000Z",
      source: "graph_api",
    });

    expect(data.posts).toHaveLength(2);
    expect(data.posts[0]).toEqual({
      id: "CODE3",
      shortcode: "CODE3",
      postedAt: "2025-05-30T08:00:00.000Z",
      kind: "carousel",
      caption: "Sourdough day #Bread #bread with @acme_farm",
      likes: 55,
      comments: 4,
      views: null,
      hashtags: ["bread"],
      mentions: ["acme_farm"],
      taggedAccounts: [],
      collaborators: [],
      location: null,
      isSponsored: false,
      isPinned: null,
      carouselCount: 3,
      accessibilityCaption: null,
    });
    // Hidden likes and a reel.
    expect(data.posts[1]).toMatchObject({
      shortcode: "CODE2",
      kind: "reel",
      likes: null,
      comments: 9,
      carouselCount: null,
      hashtags: [],
    });
  });

  it("follows paging.next until the cursors run out", async () => {
    const { source, calls } = make([{ body: page1 }, { body: page2 }]);
    const data = await source.fetchProfile("acme_bakery");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("after=CUR1");
    expect(data.posts.map((p) => p.shortcode)).toEqual(["CODE3", "CODE2", "CODE1", "CODE0"]);
    expect(data.posts[3]!.kind).toBe("video");
  });

  it("stops at `since` and does not fetch further pages", async () => {
    const { source, calls } = make([{ body: page1 }, { body: page2 }]);
    const data = await source.fetchProfile("acme_bakery", { since: "2025-05-28T08:00:00Z" });
    expect(data.posts.map((p) => p.shortcode)).toEqual(["CODE3"]);
    expect(calls).toHaveLength(1);
  });

  it("stops at `limit`, asks for that many per page and trims", async () => {
    const { source, calls } = make([{ body: page1 }, { body: page2 }]);
    const data = await source.fetchProfile("acme_bakery", { limit: 3 });
    expect(new URL(calls[0]!.url).searchParams.get("fields")).toContain("media.limit(3){");
    expect(calls).toHaveLength(2);
    expect(data.posts.map((p) => p.shortcode)).toEqual(["CODE3", "CODE2", "CODE1"]);
  });

  it("returns the profile with no posts when the account has no media", async () => {
    const { source } = make([
      { body: { business_discovery: { username: "acme_bakery", media_count: 0 } } },
    ]);
    const data = await source.fetchProfile("acme_bakery");
    expect(data.posts).toEqual([]);
    expect(data.profile.postsTotal).toBe(0);
  });

  it("makes no request without a token or with a bad handle", async () => {
    const f = fakeFetch([]);
    const source = createGraphApiSource({
      fetch: f.fetch,
      guard: fakeGuard().guard,
      accessToken: "",
      igUserId: "IGID",
    });
    expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe("unauthorized");
    const withToken = createGraphApiSource({
      fetch: f.fetch,
      guard: fakeGuard().guard,
      accessToken: TOKEN,
      igUserId: "IGID",
    });
    expect((await failureOf(withToken.fetchProfile("not a handle!"))).failure).toBe("not_found");
    expect(f.calls).toHaveLength(0);
  });

  const graphErrors: Array<[string, number, Record<string, unknown>, SourceFailure]> = [
    [
      "code 190",
      400,
      { code: 190, type: "OAuthException", message: "Invalid OAuth access token" },
      "unauthorized",
    ],
    [
      "code 102",
      400,
      { code: 102, type: "OAuthException", message: "Session expired" },
      "unauthorized",
    ],
    [
      "code 4",
      400,
      { code: 4, type: "OAuthException", message: "Application request limit reached" },
      "rate_limited",
    ],
    [
      "code 17",
      400,
      { code: 17, type: "OAuthException", message: "User request limit reached" },
      "rate_limited",
    ],
    [
      "code 32",
      400,
      { code: 32, type: "OAuthException", message: "Page request limit reached" },
      "rate_limited",
    ],
    [
      "code 613",
      400,
      {
        code: 613,
        type: "OAuthException",
        message: "Calls to this api have exceeded the rate limit",
      },
      "rate_limited",
    ],
    [
      "code 110 other message",
      400,
      { code: 110, type: "OAuthException", message: "Invalid user id" },
      "transport",
    ],
    [
      "code 100 cannot find",
      400,
      { code: 100, type: "GraphMethodException", message: "Cannot find the user" },
      "not_found",
    ],
    [
      "code 110 does not exist",
      400,
      { code: 110, type: "OAuthException", message: "The user does not exist" },
      "not_found",
    ],
    [
      "subcode 2207024",
      400,
      { code: 110, type: "OAuthException", message: "Invalid user id", error_subcode: 2207024 },
      "not_found",
    ],
    [
      "unknown code",
      400,
      { code: 1, type: "OAuthException", message: "An unknown error occurred" },
      "transport",
    ],
  ];
  it.each(graphErrors)("maps Graph error %s", async (_name, status, error, expected) => {
    const { source } = make([{ status, body: { error } }]);
    const err = await failureOf(source.fetchProfile("acme_bakery"));
    expect(err.failure).toBe(expected);
  });

  it("explains a non-business account clearly", async () => {
    const { source } = make([
      {
        status: 400,
        body: { error: { code: 110, message: "Invalid user id", error_subcode: 2207024 } },
      },
    ]);
    const err = await failureOf(source.fetchProfile("acme_bakery"));
    expect(err.message).toMatch(/not a business or creator account/);
  });

  it("honors Retry-After on a rate limit", async () => {
    const { source } = make([
      {
        status: 429,
        body: { error: { code: 4, message: "slow down" } },
        headers: { "retry-after": "12" },
      },
    ]);
    const err = await failureOf(source.fetchProfile("acme_bakery"));
    expect(err.failure).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(12000);
  });

  it("maps blocks, 5xx and network errors", async () => {
    const blocked = make([
      { status: 400, body: { error: { code: 1, message: "feedback_required" } } },
    ]);
    expect((await failureOf(blocked.source.fetchProfile("acme_bakery"))).failure).toBe("blocked");
    const down = make([{ status: 503, body: "unavailable" }]);
    expect((await failureOf(down.source.fetchProfile("acme_bakery"))).failure).toBe("transport");
    const offline = make([new Error("ECONNRESET")]);
    expect((await failureOf(offline.source.fetchProfile("acme_bakery"))).failure).toBe("transport");
  });

  it("never leaks the access token in an error", async () => {
    const leaky = make([
      {
        status: 400,
        body: {
          error: { code: 190, message: `Invalid token ${TOKEN} for access_token=${TOKEN}&x=1` },
        },
      },
    ]);
    const a = await failureOf(leaky.source.fetchProfile("acme_bakery"));
    expect(a.message).not.toContain(TOKEN);

    const net = make([
      new Error(`fetch failed: GET https://graph.facebook.com/x?access_token=${TOKEN}`),
    ]);
    const b = await failureOf(net.source.fetchProfile("acme_bakery"));
    expect(b.failure).toBe("transport");
    expect(b.message).not.toContain(TOKEN);
    expect(b.message).toContain("[redacted]");
  });

  it("reports api_drift when the success shape is wrong", async () => {
    const cases: unknown[] = [
      { id: "IGID" },
      { business_discovery: { name: "no username" } },
      { business_discovery: { username: "acme_bakery", media: { data: "nope" } } },
      {
        business_discovery: {
          username: "acme_bakery",
          media: { data: [{ id: "m1", timestamp: "garbage", media_type: "IMAGE" }] },
        },
      },
      {
        business_discovery: {
          username: "acme_bakery",
          media: {
            data: [{ id: "m1", timestamp: "2025-05-20T08:00:00+0000", media_type: "STORY" }],
          },
        },
      },
      "not json at all",
    ];
    for (const body of cases) {
      const { source } = make([{ body }]);
      expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe("api_drift");
    }
  });

  it("refuses a paging.next that leaves the Graph host", async () => {
    const evil = structuredClone(page1);
    evil.business_discovery.media.paging.next = `https://evil.example/steal?access_token=${TOKEN}`;
    const { source, calls } = make([{ body: evil }, { body: page2 }]);
    expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe("api_drift");
    expect(calls).toHaveLength(1);
  });
});
