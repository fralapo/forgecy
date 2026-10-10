import { extractHashtags, extractMentions, normalizeHandle } from "../analysis/text";
import { SourceError } from "../types";
import type {
  FetchOptions,
  PostSnapshot,
  ProfileData,
  ProfileSnapshot,
  ProfileSource,
  RequestGuard,
} from "../types";
import { classifyHttp } from "./http";

/**
 * Logged-out reader of the public Instagram web pages through a real browser. It reads
 * only: meta tags, the header text, the grid links (href + image alt) and the first
 * `<time>` of a post page. Comment text, commenter names and pictures are never read.
 */

/** What the profile page gave: nothing outside these fields ever leaves the browser. */
export interface RawProfileDom {
  finalUrl: string;
  title: string;
  headerText: string;
  /** Only `og:*` and `description` meta tags. */
  metas: Record<string, string>;
  links: { href: string; alt: string }[];
}

export interface RawPostDom {
  finalUrl: string;
  metas: Record<string, string>;
  /** `datetime` of the first `<time>` in the page (the post's own; later ones are comments). */
  firstTime: string | null;
}

export interface PageDriver {
  open(url: string): Promise<{ status: number; finalUrl: string }>;
  declineCookies(): Promise<void>;
  readProfile(): Promise<RawProfileDom>;
  readPost(): Promise<RawPostDom>;
  close(): Promise<void>;
}

export interface BrowserLauncher {
  /** A fresh browser context: no cookies or storage shared with any other driver. */
  newDriver(): Promise<PageDriver>;
  close(): Promise<void>;
}

// ---- Parsers (pure) ----

const SUFFIX = "mln|mld|mila|k|m|b";
const SCALE: Record<string, number> = {
  k: 1e3,
  mila: 1e3,
  m: 1e6,
  mln: 1e6,
  b: 1e9,
  mld: 1e9,
};

/**
 * "687M" / "12.5K" / "1,2 Mln" / "8,617" / "2.140" to a number, null when unreadable.
 * Above ~10K Instagram rounds what it shows; this gives that rounded value, not the true one.
 * Without a suffix a separator followed by exactly 3 digits is a thousands separator.
 */
export function parseCount(text: string): number | null {
  const m = new RegExp(`^(\\d[\\d.,]*)\\s*(${SUFFIX})?$`, "i").exec(text.trim());
  if (!m) return null;
  const digits = m[1]!;
  const suffix = m[2]?.toLowerCase();
  if (suffix) {
    const n = Number(digits.replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * SCALE[suffix]!) : null;
  }
  if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) return Number(digits.replace(/[.,]/g, ""));
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

const COUNT = `\\d[\\d.,]*\\s*(?:${SUFFIX})?`;

export interface ProfileMeta {
  followers: number | null;
  following: number | null;
  postsTotal: number | null;
}

/** "687M Followers, 307 Following, 8,617 Posts - See ..." (or the it-IT wording). */
export function parseProfileMeta(ogDescription: string | undefined): ProfileMeta {
  const out: ProfileMeta = { followers: null, following: null, postsTotal: null };
  const head = (ogDescription ?? "").split(" - ")[0] ?? "";
  for (const part of head.split(/,\s+/)) {
    const m = new RegExp(`^(${COUNT})\\s+(followers?|following|seguiti|posts?)$`, "i").exec(
      part.trim(),
    );
    if (!m) continue;
    const value = parseCount(m[1]!);
    const label = m[2]!.toLowerCase();
    if (label.startsWith("follower")) out.followers = value;
    else if (label === "following" || label === "seguiti") out.following = value;
    else out.postsTotal = value;
  }
  return out;
}

/** The quoted part at the end: `... su Instagram: "bio"` / `... on October 8, 2026: "caption". ` */
function quotedTail(text: string): string | null {
  const m = /:\s*"([\s\S]*)"\.?\s*$/.exec(text);
  return m?.[1] ? m[1] : null;
}

/** Bio from the `description` meta, null when the profile has none. */
export function parseBio(description: string | undefined): string | null {
  return quotedTail(description ?? "");
}

/** "Instagram (@instagram) • Instagram photos and videos" to "Instagram". */
export function parseDisplayName(ogTitle: string | undefined): string | null {
  const i = (ogTitle ?? "").indexOf(" (@");
  const name = i > 0 ? ogTitle!.slice(0, i).trim() : "";
  return name || null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DATE_TEXT = new RegExp(`(${MONTHS.join("|")}) (\\d{1,2}), (\\d{4})`);

/** "October 08, 2026" / "October 8, 2026" inside any text to "2026-10-08", null when absent. */
export function parseDateText(text: string): string | null {
  const m = DATE_TEXT.exec(text);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!) + 1;
  const day = Number(m[2]);
  if (day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface GridLink {
  shortcode: string;
  kind: "image" | "reel";
  /** "YYYY-MM-DD" from the image alt, null when the alt has no date. */
  date: string | null;
}

/** An anchor of the profile grid: `/x/reel/CODE/` + "Video by x on October 08, 2026. ...". */
export function parseGridLink(href: string, alt: string): GridLink | null {
  const m = /\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(href);
  if (!m) return null;
  return {
    shortcode: m[2]!,
    kind: m[1] === "reel" || href.includes("/reel/") ? "reel" : "image",
    date: parseDateText(alt),
  };
}

export interface PostMeta {
  likes: number | null;
  comments: number | null;
  caption: string | null;
  dateText: string | null;
}

/** `570K likes, 11K comments - x on October 8, 2026: "caption"`; the counts can be missing. */
export function parsePostMeta(ogDescription: string | undefined): PostMeta {
  const text = ogDescription ?? "";
  const caption = quotedTail(text);
  const prefix = caption === null ? text : text.slice(0, text.indexOf(': "'));
  const count = (labels: string): number | null => {
    const m = new RegExp(`(${COUNT})\\s+(?:${labels})\\b`, "i").exec(prefix);
    return m ? parseCount(m[1]!) : null;
  };
  return {
    likes: count("likes?|mi piace"),
    comments: count("comments?|commenti"),
    caption,
    dateText: DATE_TEXT.exec(prefix)?.[0] ?? null,
  };
}

// ---- Source ----

export interface PublicBrowserOptions {
  launcher: BrowserLauncher;
  guard: RequestGuard;
  /** Opt-in: when false every call throws "disabled" before anything starts. */
  enabled: boolean;
  now?: () => Date;
  /** How many of the newest grid posts get their own page (exact time, caption, counts). */
  detailPosts?: number;
}

const BASE = "https://www.instagram.com";
const BLOCKED_URL = /\/accounts\/(?:login|suspended)|\/challenge/i;
const NOT_AVAILABLE = /pagina non disponibile|page not found|isn't available|non è disponibile/i;
const PRIVATE = /this account is private|questo account è privato/i;
const NOON = "T12:00:00.000Z";

/** Failure of the navigation itself, from the status and where the browser ended up. */
function checkNavigation(nav: { status: number; finalUrl: string }): void {
  if (BLOCKED_URL.test(nav.finalUrl)) {
    throw new SourceError("blocked", "Instagram redirected to a login or a check");
  }
  const failure = classifyHttp(nav.status, "");
  // Logged out there is no token to refuse: a 401 or 403 is Instagram's wall.
  if (failure) {
    throw new SourceError(
      failure === "unauthorized" ? "blocked" : failure,
      `Public page HTTP ${nav.status}`,
    );
  }
}

function transport(err: unknown): SourceError {
  if (err instanceof SourceError) return err;
  const reason = err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err);
  return new SourceError("transport", `Browser failed: ${reason}`);
}

function minimalPrivate(handle: string, observedAt: string): ProfileData {
  return {
    profile: {
      handle,
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
      observedAt,
      source: "public_web",
    },
    posts: [],
  };
}

interface GridPost extends GridLink {
  alt: string;
}

function gridPost(link: GridPost): PostSnapshot {
  return {
    id: link.shortcode,
    shortcode: link.shortcode,
    // Day precision: the grid gives a date, not a time. Noon keeps the day in most time zones.
    postedAt: `${link.date}${NOON}`,
    postedAtPrecision: "day",
    kind: link.kind,
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
    accessibilityCaption: link.alt || null,
  };
}

function withDetail(base: PostSnapshot, dom: RawPostDom): PostSnapshot {
  const meta = parsePostMeta(dom.metas["og:description"]);
  const exact = dom.firstTime ? Date.parse(dom.firstTime) : Number.NaN;
  const day = meta.dateText ? parseDateText(meta.dateText) : null;
  const when = !Number.isNaN(exact)
    ? { postedAt: new Date(exact).toISOString(), postedAtPrecision: "time" as const }
    : day
      ? { postedAt: `${day}${NOON}`, postedAtPrecision: "day" as const }
      : {};
  return {
    ...base,
    ...when,
    caption: meta.caption,
    likes: meta.likes,
    comments: meta.comments,
    hashtags: extractHashtags(meta.caption),
    mentions: extractMentions(meta.caption),
  };
}

export function createPublicBrowserSource(options: PublicBrowserOptions): ProfileSource {
  const { launcher, guard, enabled } = options;
  const now = options.now ?? (() => new Date());
  const detailPosts = options.detailPosts ?? 6;

  return {
    id: "public_web",
    async fetchProfile(handleInput: string, opts: FetchOptions = {}): Promise<ProfileData> {
      if (!enabled) {
        throw new SourceError(
          "disabled",
          "The public web source is switched off in this installation",
        );
      }
      const handle = normalizeHandle(handleInput);
      if (!handle) throw new SourceError("not_found", "Not a valid Instagram handle");

      const driver = await launcher.newDriver().catch((err: unknown) => {
        throw transport(err);
      });
      try {
        return await read(driver, handle, opts);
      } catch (err) {
        throw transport(err);
      } finally {
        await driver.close().catch(() => undefined);
      }
    },
  };

  async function read(
    driver: PageDriver,
    handle: string,
    opts: FetchOptions,
  ): Promise<ProfileData> {
    const observedAt = now().toISOString();
    const dom = await guard.run("public_web", async () => {
      checkNavigation(await driver.open(`${BASE}/${handle}/`));
      // The dialog is optional: a failed click shows up below as an empty page.
      await driver.declineCookies().catch(() => undefined);
      return driver.readProfile();
    });

    if (BLOCKED_URL.test(dom.finalUrl)) {
      throw new SourceError("blocked", "Instagram redirected to a login or a check");
    }
    if (NOT_AVAILABLE.test(`${dom.title} ${dom.metas["og:title"] ?? ""}`)) {
      throw new SourceError("not_found", "The profile page is not available");
    }
    if (PRIVATE.test(dom.headerText)) return minimalPrivate(handle, observedAt);
    const ogDescription = dom.metas["og:description"];
    if (!dom.headerText.trim() && !ogDescription) {
      throw new SourceError("blocked", "The profile page has no content: a wall or a check");
    }

    const counts = parseProfileMeta(ogDescription);
    if (counts.followers === null) {
      throw new SourceError("api_drift", "Profile counts are not in the page meta tags");
    }
    const profile: ProfileSnapshot = {
      handle,
      fullName: parseDisplayName(dom.metas["og:title"]),
      biography: parseBio(dom.metas["description"]),
      externalUrl: null,
      category: null,
      isBusiness: null,
      isVerified: null,
      isPrivate: false,
      ...counts,
      pictureHash: null, // og:image is a CDN picture: never fetched
      observedAt,
      source: "public_web",
    };

    // Grid order puts pinned posts first: sort by day, newest first (stable).
    const seen = new Set<string>();
    const grid: GridPost[] = [];
    for (const { href, alt } of dom.links) {
      const link = parseGridLink(href, alt);
      if (!link || seen.has(link.shortcode)) continue;
      seen.add(link.shortcode);
      if (link.date) grid.push({ ...link, alt });
    }
    if (dom.links.length > 0 && grid.length === 0) {
      throw new SourceError("api_drift", "Grid posts have no shortcode or date");
    }
    grid.sort((a, b) => b.date!.localeCompare(a.date!));

    const sinceMs = opts.since ? Date.parse(opts.since) : Number.NaN;
    // A day-precision post is kept when any moment of its day is after `since`.
    const wanted = grid
      .filter(
        (g) => Number.isNaN(sinceMs) || Date.parse(`${g.date}T00:00:00.000Z`) + 864e5 > sinceMs,
      )
      .slice(0, opts.limit ?? grid.length);

    const posts = wanted.map(gridPost);
    for (const [i, g] of wanted.slice(0, detailPosts).entries()) {
      try {
        const path = g.kind === "reel" ? "reel" : "p";
        const detail = await guard.run("public_web", async () => {
          checkNavigation(await driver.open(`${BASE}/${handle}/${path}/${g.shortcode}/`));
          return driver.readPost();
        });
        posts[i] = withDetail(posts[i]!, detail);
      } catch (err) {
        // A wall ends the run; any other failure keeps the profile and the grid already read.
        if (err instanceof SourceError && err.failure === "blocked") throw err;
        break;
      }
    }

    // Detailed posts have an exact time now: apply `since` to it.
    const exact = posts
      .filter(
        (p) =>
          p.postedAtPrecision !== "time" ||
          Number.isNaN(sinceMs) ||
          Date.parse(p.postedAt) > sinceMs,
      )
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    return { profile, posts: exact };
  }
}
