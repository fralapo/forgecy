import { describe, expect, it } from "vitest";
import {
  createPublicBrowserSource,
  parseBio,
  parseCount,
  parseDateText,
  parseDisplayName,
  parseGridLink,
  parsePostMeta,
  parseProfileMeta,
} from "../src/sources/public-browser";
import type {
  BrowserLauncher,
  PageDriver,
  RawPostDom,
  RawProfileDom,
} from "../src/sources/public-browser";
import { createSocialRuntime } from "../src/service/runtime";
import { SourceError } from "../src/types";
import type { RequestGuard } from "../src/types";

describe("parseCount", () => {
  const table: Array<[string, number | null]> = [
    ["687M", 687_000_000],
    ["12.5K", 12_500],
    ["12,5 k", 12_500],
    ["8,617", 8617],
    ["2.140", 2140],
    ["1.2B", 1_200_000_000],
    ["686 Mln", 686_000_000],
    ["1,2 Mld", 1_200_000_000],
    ["307", 307],
    ["0", 0],
    ["1,234,567", 1_234_567],
    ["", null],
    ["many", null],
    ["12.5", null],
  ];
  it.each(table)("%s -> %s", (text, expected) => {
    expect(parseCount(text)).toBe(expected);
  });
});

describe("profile meta parsers", () => {
  it("reads the English wording", () => {
    expect(
      parseProfileMeta(
        "687M Followers, 307 Following, 8,617 Posts - See Instagram photos and videos from Instagram (@instagram)",
      ),
    ).toEqual({ followers: 687_000_000, following: 307, postsTotal: 8617 });
  });

  it("reads the Italian wording", () => {
    expect(
      parseProfileMeta(
        "687M follower, 307 seguiti, 8,617 post - Vedi le foto e i video di Instagram di Instagram (@instagram)",
      ),
    ).toEqual({ followers: 687_000_000, following: 307, postsTotal: 8617 });
  });

  it("gives nulls for an unreadable text", () => {
    expect(parseProfileMeta(undefined)).toEqual({
      followers: null,
      following: null,
      postsTotal: null,
    });
    expect(parseProfileMeta("Log in to Instagram")).toEqual({
      followers: null,
      following: null,
      postsTotal: null,
    });
  });

  it("reads the bio from the quoted part", () => {
    expect(
      parseBio(
        '687M follower, 307 seguiti, 8,617 post - Instagram (@instagram) su Instagram: "Discover what\'s new on Instagram 🔎✨"',
      ),
    ).toBe("Discover what's new on Instagram 🔎✨");
    expect(parseBio("1 Follower, 2 Following, 3 Posts - Acme (@acme) on Instagram")).toBeNull();
    expect(parseBio(undefined)).toBeNull();
  });

  it("reads the display name before the handle", () => {
    expect(parseDisplayName("Instagram (@instagram) • Instagram photos and videos")).toBe(
      "Instagram",
    );
    expect(parseDisplayName("Foto e Video (@x) • Foto e video di X")).toBe("Foto e Video");
    expect(parseDisplayName("(@x)")).toBeNull();
    expect(parseDisplayName(undefined)).toBeNull();
  });
});

describe("parseGridLink", () => {
  it("reads a reel with the English alt", () => {
    expect(
      parseGridLink(
        "/instagram/reel/DePb6WLuVae/",
        "Video by Instagram on October 08, 2026. May be an image of text",
      ),
    ).toEqual({ shortcode: "DePb6WLuVae", kind: "reel", date: "2026-10-08" });
  });

  it("reads a photo with a one-digit day and the Italian remainder", () => {
    expect(
      parseGridLink(
        "https://www.instagram.com/instagram/p/XXXX_-1/",
        "Photo by Instagram on October 8, 2026. Potrebbe essere un'immagine raffigurante cielo",
      ),
    ).toEqual({ shortcode: "XXXX_-1", kind: "image", date: "2026-10-08" });
  });

  it("keeps the post when the alt has no date and rejects other links", () => {
    expect(parseGridLink("/x/p/AbC/", "")).toEqual({ shortcode: "AbC", kind: "image", date: null });
    expect(parseGridLink("/x/", "Photo by x on October 8, 2026")).toBeNull();
  });
});

describe("parseDateText and parsePostMeta", () => {
  it("parses a date or gives null", () => {
    expect(parseDateText("on March 3, 2025")).toBe("2025-03-03");
    expect(parseDateText("on Smarch 3, 2025")).toBeNull();
  });

  it("reads likes, comments, caption and date", () => {
    const meta = parsePostMeta(
      '570K likes, 11K comments - instagram on October 8, 2026: "fur real, ...caption...\n\n#InTheMoment\n\nVideo by @x". ',
    );
    expect(meta).toEqual({
      likes: 570_000,
      comments: 11_000,
      caption: "fur real, ...caption...\n\n#InTheMoment\n\nVideo by @x",
      dateText: "October 8, 2026",
    });
  });

  it("reads the Italian wording and a post with no counts", () => {
    expect(
      parsePostMeta('1,234 Mi piace, 56 commenti - instagram su October 8, 2026: "ciao"'),
    ).toMatchObject({ likes: 1234, comments: 56, caption: "ciao" });
    expect(parsePostMeta('instagram on October 8, 2026: "caption"')).toEqual({
      likes: null,
      comments: null,
      caption: "caption",
      dateText: "October 8, 2026",
    });
  });

  it("does not take counts from the caption", () => {
    expect(parsePostMeta('x on October 8, 2026: "we got 500 likes"').likes).toBeNull();
  });

  it("handles a missing text", () => {
    expect(parsePostMeta(undefined)).toEqual({
      likes: null,
      comments: null,
      caption: null,
      dateText: null,
    });
  });
});

// ---- The source, with a fake browser ----

const NOW = new Date("2026-10-10T08:00:00.000Z");

const PROFILE_METAS = {
  "og:title": "Acme Bakery (@acme_bakery) • Instagram photos and videos",
  "og:description":
    "12.5K Followers, 80 Following, 2,140 Posts - See Instagram photos and videos from Acme Bakery (@acme_bakery)",
  description:
    '12.5K Followers, 80 Following, 2,140 Posts - Acme Bakery (@acme_bakery) on Instagram: "Fresh bread daily"',
};

function gridLink(code: string, day: string, reel = false) {
  const kind = reel ? "reel" : "p";
  return {
    href: `/acme_bakery/${kind}/${code}/`,
    alt: `${reel ? "Video" : "Photo"} by Acme on October ${day}, 2026. May be an image of bread`,
  };
}

function profileDom(over: Partial<RawProfileDom> = {}): RawProfileDom {
  return {
    finalUrl: "https://www.instagram.com/acme_bakery/",
    title: "Acme Bakery (@acme_bakery) • Instagram photos and videos",
    headerText: "acme_bakery\n12.5K followers\n80 following\nAcme Bakery\nFresh bread daily",
    metas: PROFILE_METAS,
    links: [
      gridLink("OLD1", "01"),
      gridLink("NEW1", "09", true),
      gridLink("MID1", "05"),
      gridLink("NEW2", "08"),
      gridLink("MID2", "04"),
      { ...gridLink("NEW2", "08") },
    ],
    ...over,
  };
}

const POSTS: Record<string, RawPostDom> = {
  NEW1: {
    finalUrl: "x",
    metas: {
      "og:description":
        '570K likes, 11K comments - acme_bakery on October 9, 2026: "New batch #Bread with @acme_farm"',
    },
    firstTime: "2026-10-09T17:10:30.000Z",
  },
  NEW2: {
    finalUrl: "x",
    metas: { "og:description": 'acme_bakery on October 8, 2026: "Quiet day"' },
    firstTime: "2026-10-08T06:00:00.000Z",
  },
};

interface Script {
  status?: number;
  finalUrl?: string;
  profile?: RawProfileDom;
  /** Per post URL status override. */
  postStatus?: Record<string, number>;
  failOpen?: Error;
}

function fakeBrowser(script: Script = {}) {
  const calls: string[] = [];
  let closed = 0;
  let launched = 0;
  let current = "";
  const driver: PageDriver = {
    async open(url) {
      calls.push(`open ${url}`);
      current = url;
      if (script.failOpen) throw script.failOpen;
      const code = /\/(?:p|reel)\/([^/]+)\/$/.exec(url)?.[1];
      return {
        status: (code && script.postStatus?.[code]) || script.status || 200,
        finalUrl: script.finalUrl ?? url,
      };
    },
    async declineCookies() {
      calls.push("declineCookies");
    },
    async readProfile() {
      calls.push("readProfile");
      return script.profile ?? profileDom();
    },
    async readPost() {
      calls.push("readPost");
      const code = /\/(?:p|reel)\/([^/]+)\/$/.exec(current)?.[1] ?? "";
      const post = POSTS[code];
      if (!post) throw new Error(`no fixture for ${code}`);
      return post;
    },
    async close() {
      closed++;
    },
  };
  const launcher: BrowserLauncher = {
    async newDriver() {
      launched++;
      return driver;
    },
    async close() {},
  };
  return { launcher, calls, closed: () => closed, launched: () => launched };
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

function make(script: Script = {}, extra: { enabled?: boolean; detailPosts?: number } = {}) {
  const b = fakeBrowser(script);
  const g = fakeGuard();
  const source = createPublicBrowserSource({
    launcher: b.launcher,
    guard: g.guard,
    enabled: extra.enabled ?? true,
    now: () => NOW,
    ...(extra.detailPosts !== undefined ? { detailPosts: extra.detailPosts } : {}),
  });
  return { source, ...b, ...g };
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

describe("public browser source", () => {
  it("reads the profile, details the newest posts and keeps the rest at day precision", async () => {
    const { source, calls, buckets, closed, launched } = make({}, { detailPosts: 2 });
    const data = await source.fetchProfile("@Acme_Bakery");

    expect(source.id).toBe("public_web");
    expect(data.profile).toEqual({
      handle: "acme_bakery",
      fullName: "Acme Bakery",
      biography: "Fresh bread daily",
      externalUrl: null,
      category: null,
      isBusiness: null,
      isVerified: null,
      isPrivate: false,
      followers: 12_500,
      following: 80,
      postsTotal: 2140,
      pictureHash: null,
      observedAt: "2026-10-10T08:00:00.000Z",
      source: "public_web",
    });

    expect(data.posts.map((p) => p.shortcode)).toEqual(["NEW1", "NEW2", "MID1", "MID2", "OLD1"]);
    expect(data.posts[0]).toMatchObject({
      id: "NEW1",
      kind: "reel",
      postedAt: "2026-10-09T17:10:30.000Z",
      postedAtPrecision: "time",
      caption: "New batch #Bread with @acme_farm",
      likes: 570_000,
      comments: 11_000,
      hashtags: ["bread"],
      mentions: ["acme_farm"],
      views: null,
    });
    expect(data.posts[1]).toMatchObject({
      postedAt: "2026-10-08T06:00:00.000Z",
      postedAtPrecision: "time",
      likes: null,
      comments: null,
      caption: "Quiet day",
    });
    expect(data.posts[2]).toMatchObject({
      shortcode: "MID1",
      kind: "image",
      postedAt: "2026-10-05T12:00:00.000Z",
      postedAtPrecision: "day",
      caption: null,
      likes: null,
      comments: null,
      views: null,
      accessibilityCaption: "Photo by Acme on October 05, 2026. May be an image of bread",
    });

    // One driver, one context, always closed; profile page then the two detailed posts, paced.
    expect(launched()).toBe(1);
    expect(closed()).toBe(1);
    expect(buckets).toEqual(["public_web", "public_web", "public_web"]);
    expect(calls).toEqual([
      "open https://www.instagram.com/acme_bakery/",
      "declineCookies",
      "readProfile",
      "open https://www.instagram.com/acme_bakery/reel/NEW1/",
      "readPost",
      "open https://www.instagram.com/acme_bakery/p/NEW2/",
      "readPost",
    ]);
  });

  it("details 6 posts by default and never reads anything else", async () => {
    const links = [gridLink("NEW1", "09", true), gridLink("NEW2", "08")];
    const { source, calls } = make({ profile: profileDom({ links }) });
    const data = await source.fetchProfile("acme_bakery");
    expect(data.posts).toHaveLength(2);
    // The fake driver exposes no read of comments: these are all the calls there can be.
    expect(new Set(calls.map((c) => c.split(" ")[0]))).toEqual(
      new Set(["open", "declineCookies", "readProfile", "readPost"]),
    );
  });

  it("is disabled before anything starts", async () => {
    const { source, calls, launched } = make({}, { enabled: false });
    expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe("disabled");
    expect(calls).toEqual([]);
    expect(launched()).toBe(0);
  });

  it("rejects a bad handle without a browser", async () => {
    const { source, launched } = make();
    expect((await failureOf(source.fetchProfile("not a handle!"))).failure).toBe("not_found");
    expect(launched()).toBe(0);
  });

  it("returns only the minimal profile for a private account", async () => {
    const { source, closed, calls } = make({
      profile: profileDom({ headerText: "acme_bakery\nThis account is private\n12 followers" }),
    });
    const data = await source.fetchProfile("acme_bakery");
    expect(data.posts).toEqual([]);
    expect(data.profile).toEqual({
      handle: "acme_bakery",
      fullName: null,
      biography: null,
      externalUrl: null,
      category: null,
      isBusiness: null,
      isVerified: null,
      isPrivate: true,
      followers: null,
      following: null,
      postsTotal: null,
      pictureHash: null,
      observedAt: "2026-10-10T08:00:00.000Z",
      source: "public_web",
    });
    expect(closed()).toBe(1);
    expect(calls.some((c) => c.startsWith("readPost"))).toBe(false);
  });

  it("recognizes the Italian private marker", async () => {
    const { source } = make({
      profile: profileDom({ headerText: "acme\nQuesto account è privato" }),
    });
    expect((await source.fetchProfile("acme_bakery")).profile.isPrivate).toBe(true);
  });

  const failures: Array<[string, Script, string]> = [
    [
      "login redirect",
      { finalUrl: "https://www.instagram.com/accounts/login/?next=/a/" },
      "blocked",
    ],
    ["challenge redirect", { finalUrl: "https://www.instagram.com/challenge/?x=1" }, "blocked"],
    ["suspended", { finalUrl: "https://www.instagram.com/accounts/suspended/" }, "blocked"],
    ["403", { status: 403 }, "blocked"],
    ["404", { status: 404 }, "not_found"],
    ["429", { status: 429 }, "rate_limited"],
    ["500", { status: 503 }, "transport"],
    ["navigation timeout", { failOpen: new Error("Timeout 20000ms exceeded") }, "transport"],
    [
      "empty app shell",
      { profile: profileDom({ headerText: "", metas: {}, links: [] }) },
      "blocked",
    ],
    [
      "login wall rendered in place",
      { profile: profileDom({ finalUrl: "https://www.instagram.com/accounts/login/" }) },
      "blocked",
    ],
    [
      "not available (it)",
      {
        profile: profileDom({
          title: "Pagina non disponibile • Instagram",
          headerText: "",
          metas: {},
        }),
      },
      "not_found",
    ],
    [
      "not available (en)",
      { profile: profileDom({ title: "Page Not Found • Instagram", headerText: "", metas: {} }) },
      "not_found",
    ],
    [
      "counts unparsable",
      {
        profile: profileDom({
          metas: { ...PROFILE_METAS, "og:description": "Something else entirely" },
        }),
      },
      "api_drift",
    ],
    [
      "grid without shortcodes or dates",
      { profile: profileDom({ links: [{ href: "/x/p/AAA/", alt: "" }] }) },
      "api_drift",
    ],
  ];
  it.each(failures)("maps %s to %s and closes the driver", async (_name, script, failure) => {
    const { source, closed } = make(script);
    expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe(failure);
    expect(closed()).toBe(1);
  });

  it("carries on without the cookie step", async () => {
    // declineCookies resolves without clicking when no dialog shows up.
    const { source, calls } = make();
    await source.fetchProfile("acme_bakery", { limit: 1 });
    expect(calls).toContain("declineCookies");
  });

  it("does not fail when declining the cookies throws", async () => {
    const b = fakeBrowser();
    const base = await b.launcher.newDriver();
    const launcher: BrowserLauncher = {
      newDriver: async () => ({
        ...base,
        declineCookies: async () => {
          throw new Error("no such button");
        },
      }),
      close: async () => {},
    };
    const source = createPublicBrowserSource({ launcher, guard: fakeGuard().guard, enabled: true });
    expect((await source.fetchProfile("acme_bakery", { limit: 1 })).posts).toHaveLength(1);
  });

  it("closes the driver when a post read throws a wall, and passes the wall on", async () => {
    const { source, closed } = make({ postStatus: { NEW1: 403 } });
    expect((await failureOf(source.fetchProfile("acme_bakery"))).failure).toBe("blocked");
    expect(closed()).toBe(1);
  });

  it("keeps the grid when a post page fails for another reason", async () => {
    const { source, closed } = make({ postStatus: { NEW1: 404 } });
    const data = await source.fetchProfile("acme_bakery");
    expect(data.posts).toHaveLength(5);
    expect(data.posts.every((p) => p.postedAtPrecision === "day")).toBe(true);
    expect(closed()).toBe(1);
  });

  it("turns a launcher failure into a transport error", async () => {
    const launcher: BrowserLauncher = {
      newDriver: async () => {
        throw new Error("Executable doesn't exist\nlong playwright help");
      },
      close: async () => {},
    };
    const source = createPublicBrowserSource({ launcher, guard: fakeGuard().guard, enabled: true });
    const err = await failureOf(source.fetchProfile("acme_bakery"));
    expect(err.failure).toBe("transport");
    expect(err.message).not.toContain("help");
  });

  it("honours limit and since", async () => {
    const limited = await make().source.fetchProfile("acme_bakery", { limit: 2 });
    expect(limited.posts.map((p) => p.shortcode)).toEqual(["NEW1", "NEW2"]);

    // Newer than Oct 8 12:00: NEW1 (Oct 9) stays; NEW2 is exact on Oct 8 06:00 and goes.
    const since = await make().source.fetchProfile("acme_bakery", {
      since: "2026-10-08T12:00:00.000Z",
    });
    expect(since.posts.map((p) => p.shortcode)).toEqual(["NEW1"]);

    // Day-precision posts are kept when any moment of their day is after `since`.
    const sameDay = await make({}, { detailPosts: 0 }).source.fetchProfile("acme_bakery", {
      since: "2026-10-08T20:00:00.000Z",
    });
    expect(sameDay.posts.map((p) => p.shortcode)).toEqual(["NEW1", "NEW2"]);
  });
});

describe("social runtime with the browser source", () => {
  const env = {
    INSTAGRAM_GRAPH_TOKEN: undefined,
    INSTAGRAM_GRAPH_USER_ID: undefined,
    INSTAGRAM_GRAPH_VERSION: "v21.0",
    FORGECY_SOCIAL_PUBLIC_WEB: true,
  };

  it("lists public_web by the flag alone but opens it only with a launcher", () => {
    expect(createSocialRuntime(env).available()).toEqual(["public_web"]);
    expect(createSocialRuntime(env).open("public_web")).toBeUndefined();
    const { launcher } = fakeBrowser();
    expect(createSocialRuntime(env, { launcher }).open("public_web")?.id).toBe("public_web");
  });

  it("is not available when the flag is off", () => {
    const off = { ...env, FORGECY_SOCIAL_PUBLIC_WEB: false };
    const { launcher } = fakeBrowser();
    expect(createSocialRuntime(off, { launcher }).available()).toEqual([]);
    expect(createSocialRuntime(off, { launcher }).open("public_web")).toBeUndefined();
  });
});
