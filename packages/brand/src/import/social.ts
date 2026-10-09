/**
 * Public social profiles as brand sources: what a profile page says about itself (name and
 * bio), read the way a link preview does.
 *
 * Reading rule (legal and ethical, kept here on purpose): logged-out public pages only. The
 * profile host's robots.txt is honored for our agent token, there is no cookie, no login, no
 * retry and no JavaScript rendering, and exactly one GET is made per profile. A login wall, a
 * robots refusal or a network error reads nothing and says so. Only the extracted text (title,
 * description) is kept, never the HTML.
 */
import { createHostCheck, createPinnedFetch, type ProbeImage } from "@forgecy/audit";
import { robotsAllows } from "@forgecy/audit/crawl/crawler";
import { auditUserAgent, JSON_LD } from "@forgecy/audit/crawl/fetcher";
import type { MessageRef } from "@forgecy/core";
import { guardedFetch, readCapped, type HostCheck } from "@forgecy/core/net-guard";
import { englishMessage, messageRef, type MessageKey } from "@forgecy/i18n";
import { updateSourceStatus } from "../service";
import { harvestImages, type HarvestDeps } from "./images";

export { isSocialKind, socialKindOf, socialProfileOf, type SocialKind } from "../social-url";

/** Locator of the one page a profile gives: English text of an i18n key, translated when shown. */
export const SOCIAL_LOCATOR = englishMessage("brand.import.locators.socialProfile");

export const SOCIAL_LIMITS = {
  timeoutMs: 10_000,
  bodyBytes: 1024 * 1024,
  textChars: 4000,
} as const;

// ---- what the page says ----

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const decode = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : undefined;
    if (code !== undefined) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    return ENTITIES[String(name).toLowerCase()] ?? all;
  });
const tidy = (s: string | undefined) =>
  decode(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** Login, sign-in or "accedi" in a page title: the page is the platform's door, not the profile. */
const LOGIN_TITLE = /\b(log\s?in|sign\s?in|accedi)\b/i;
const LOGIN_PATH = /\/(?:accounts\/)?login|authwall|checkpoint/i;

function jsonLdDescription(html: string): string | undefined {
  const found: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.slice(0, 50).forEach((n) => visit(n, depth + 1));
    const obj = node as Record<string, unknown>;
    const types = [obj["@type"]].flat();
    if (
      typeof obj.description === "string" &&
      types.some((t) => t === "Organization" || t === "Person" || t === "LocalBusiness")
    )
      found.push(obj.description);
    visit(obj["@graph"], depth + 1);
  };
  for (const m of html.matchAll(JSON_LD))
    try {
      visit(JSON.parse(m[1]!), 0);
    } catch {
      // Invalid JSON-LD declares nothing.
    }
  return found.map(tidy).find(Boolean);
}

/** Title, description and picture a profile page declares in its head; does not render anything. */
export function parseSocialMeta(html: string): {
  title?: string;
  description?: string;
  image?: string;
  loginWall: boolean;
} {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[0].matchAll(/([a-z_:][-a-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? "";
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  const pageTitle = tidy(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const ogTitle = tidy(meta.get("og:title"));
  const title = ogTitle || pageTitle;
  const description =
    tidy(meta.get("og:description")) ||
    tidy(meta.get("description")) ||
    jsonLdDescription(html) ||
    "";
  const image = tidy(meta.get("og:image"));
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    loginWall: LOGIN_TITLE.test(ogTitle) || LOGIN_TITLE.test(pageTitle),
  };
}

// ---- reading one profile ----

export type SocialPartial = "login_wall" | "robots" | "unreachable";

export interface SocialProfile {
  pages: Array<{ locator: string; text: string }>;
  /** Absolute address of the profile picture (og:image). */
  image?: string;
  partial?: SocialPartial;
}

export interface SocialNet {
  allowPrivate?: boolean;
  hostCheck?: HostCheck;
  timeoutMs?: number;
  userAgent?: string;
}

const LOGIN_STATUSES = new Set([401, 403, 999]); // 999 is LinkedIn's refusal of anonymous readers

export async function readSocialProfile(
  url: string,
  fetchImpl?: typeof fetch,
  net: SocialNet = {},
): Promise<SocialProfile> {
  const unreachable: SocialProfile = { pages: [], partial: "unreachable" };
  try {
    const target = new URL(url);
    if (!/^https?:$/.test(target.protocol) || target.username || target.password)
      return unreachable;
    const hostCheck = net.hostCheck ?? createHostCheck({ allowPrivate: !!net.allowPrivate });
    const impl = fetchImpl ?? createPinnedFetch({ allowPrivate: !!net.allowPrivate });
    const userAgent = net.userAgent ?? auditUserAgent();
    const timeoutMs = net.timeoutMs ?? SOCIAL_LIMITS.timeoutMs;
    const robots = { userAgent, fetchImpl: impl, hostCheck };

    if (!(await robotsAllows(url, robots))) return { pages: [], partial: "robots" };
    const { res, url: landed } = await guardedFetch(url, {
      hostCheck,
      fetchImpl: impl,
      timeoutMs,
      headers: { accept: "text/html", "user-agent": userAgent },
    });
    if (LOGIN_STATUSES.has(res.status) || LOGIN_PATH.test(new URL(landed).pathname)) {
      await res.body?.cancel().catch(() => undefined);
      return { pages: [], partial: "login_wall" };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return unreachable;
    }
    // A redirect to another host is another robots.txt to honor.
    if (new URL(landed).origin !== target.origin && !(await robotsAllows(landed, robots))) {
      await res.body?.cancel().catch(() => undefined);
      return { pages: [], partial: "robots" };
    }
    const { bytes } = await readCapped(res, SOCIAL_LIMITS.bodyBytes);
    const meta = parseSocialMeta(new TextDecoder().decode(bytes));
    if (meta.loginWall) return { pages: [], partial: "login_wall" };
    const text = [meta.title, meta.description]
      .filter((v): v is string => !!v)
      .join("\n")
      .slice(0, SOCIAL_LIMITS.textChars);
    if (!text) return unreachable;
    let image: string | undefined;
    try {
      const abs = meta.image ? new URL(meta.image, landed) : undefined;
      if (abs && /^https?:$/.test(abs.protocol)) image = abs.toString();
    } catch {
      // An unreadable picture address is simply left out.
    }
    return { pages: [{ locator: SOCIAL_LOCATOR, text }], ...(image ? { image } : {}) };
  } catch {
    return unreachable;
  }
}

// ---- storing it on a source ----

const PARTIAL_KEY = {
  login_wall: "brand.import.status.socialLoginWall",
  robots: "brand.import.status.socialRobots",
  unreachable: "brand.import.status.socialUnreachable",
} as const satisfies Record<SocialPartial, MessageKey>;

export interface SocialSourceOptions extends SocialNet {
  clientId: string;
  requestedBy?: string | null;
  fetchImpl?: typeof fetch;
}

/**
 * Reads a profile source, saves its page on the source and its picture in the asset library.
 * When nothing is readable the source becomes `partial` with the reason and no pages.
 * Shared by the website crawl and by a profile link added by hand.
 */
export async function readSocialSource(
  deps: Pick<HarvestDeps, "db" | "storage">,
  source: { id: string; url: string },
  options: SocialSourceOptions,
): Promise<SocialProfile & { detail: string }> {
  const profile = await readSocialProfile(source.url, options.fetchImpl, options);
  if (!profile.pages.length) {
    const ref: MessageRef = messageRef(PARTIAL_KEY[profile.partial ?? "unreachable"]);
    const detail = englishMessage(ref.key as MessageKey);
    await updateSourceStatus(deps.db, source.id, {
      status: "partial",
      pages: [],
      statusDetail: detail,
      statusDetailRef: [ref],
    });
    return { ...profile, detail };
  }
  await updateSourceStatus(deps.db, source.id, { pages: profile.pages });
  if (profile.image)
    try {
      const picture: ProbeImage = {
        url: profile.image,
        alt: "",
        w: 0,
        h: 0,
        inHeader: false,
        inFooter: false,
        repeats: 0,
        source: "og",
      };
      await harvestImages(deps, {
        clientId: options.clientId,
        sourceId: source.id,
        images: [picture],
        tags: ["social"],
        minSide: 100,
        max: 1,
        requestedBy: options.requestedBy ?? null,
        allowPrivate: !!options.allowPrivate,
        ...(options.hostCheck ? { hostCheck: options.hostCheck } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch {
      // The picture is a bonus: the text of the profile is still imported.
    }
  return { ...profile, detail: "" };
}
