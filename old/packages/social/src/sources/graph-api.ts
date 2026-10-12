import { extractHashtags, extractMentions, normalizeHandle } from "../analysis/text";
import { SourceError } from "../types";
import type {
  FetchLike,
  FetchOptions,
  MediaKind,
  PostSnapshot,
  ProfileData,
  ProfileSnapshot,
  ProfileSource,
  RequestGuard,
  SourceFailure,
} from "../types";
import { endpoints } from "./endpoints";
import { classifyHttp, isRecord, num, send, str, tryParseJson } from "./http";
import type { HttpResult, Json } from "./http";

export interface GraphApiOptions {
  fetch: FetchLike;
  guard: RequestGuard;
  accessToken: string;
  /** Instagram user id of the connected business account that makes the call. */
  igUserId: string;
  now?: () => Date;
  apiVersion?: string;
  /** Posts per page, default from endpoints. */
  pageSize?: number;
}

// Safety bound if the API keeps returning cursors.
const MAX_PAGES = 40;

function makeRedact(token: string): (text: string) => string {
  return (text) => {
    let out = text;
    if (token) {
      out = out.split(token).join("[redacted]").split(encodeURIComponent(token)).join("[redacted]");
    }
    return out.replace(/access_token=[^&\s"']+/g, "access_token=[redacted]");
  };
}

/** Graph error body `{error:{code,type,message}}` to a failure. */
function graphFailure(error: Json): { failure: SourceFailure; note?: string } {
  const code = num(error.code);
  const sub = num(error.error_subcode);
  const message = str(error.message) ?? "";
  if (code === 190 || code === 102) return { failure: "unauthorized" };
  if (code === 4 || code === 17 || code === 32 || code === 613) return { failure: "rate_limited" };
  if (sub === 2207024) {
    return {
      failure: "not_found",
      note: "Account is not a business or creator account, so Business Discovery cannot read it",
    };
  }
  if ((code === 110 || code === 100) && /cannot find|does not exist/i.test(message)) {
    return { failure: "not_found", note: "Account not found" };
  }
  return { failure: "transport" };
}

function drift(what: string): SourceError {
  return new SourceError("api_drift", `Graph API response has an unexpected shape: ${what}`);
}

/** Graph timestamps look like 2024-05-01T10:00:00+0000. */
function toIso(value: unknown): string {
  const raw = str(value);
  const date = raw ? new Date(raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : null;
  if (!date || Number.isNaN(date.getTime())) throw drift("timestamp");
  return date.toISOString();
}

function mapKind(type: string | null, productType: string | null): MediaKind {
  if (type === "IMAGE") return "image";
  if (type === "VIDEO") return productType === "REELS" ? "reel" : "video";
  if (type === "CAROUSEL_ALBUM") return "carousel";
  throw drift(`media_type ${String(type)}`);
}

function mapMedia(item: unknown): PostSnapshot {
  if (!isRecord(item)) throw drift("media item");
  const mediaId = str(item.id);
  if (!mediaId) throw drift("media id");
  const kind = mapKind(str(item.media_type), str(item.media_product_type));
  const permalink = str(item.permalink);
  const shortcode = permalink?.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1] ?? null;
  const caption = str(item.caption);
  const children =
    isRecord(item.children) && Array.isArray(item.children.data) ? item.children.data : null;
  return {
    id: shortcode ?? mediaId,
    shortcode,
    postedAt: toIso(item.timestamp),
    kind,
    caption,
    likes: num(item.like_count),
    comments: num(item.comments_count),
    views: null,
    hashtags: extractHashtags(caption),
    mentions: extractMentions(caption),
    taggedAccounts: [],
    collaborators: [],
    location: null,
    isSponsored: false,
    isPinned: null,
    carouselCount: kind === "carousel" && children ? children.length : null,
    accessibilityCaption: null,
  };
}

function mapProfile(bd: Json, observedAt: string): ProfileSnapshot {
  const username = str(bd.username);
  if (!username) throw drift("username");
  return {
    handle: username.toLowerCase(),
    fullName: str(bd.name),
    biography: str(bd.biography),
    externalUrl: str(bd.website),
    category: null,
    isBusiness: true,
    isVerified: null,
    isPrivate: false,
    followers: num(bd.followers_count),
    following: num(bd.follows_count),
    postsTotal: num(bd.media_count),
    pictureHash: null,
    observedAt,
    source: "graph_api",
  };
}

export function createGraphApiSource(options: GraphApiOptions): ProfileSource {
  const { fetch, guard, accessToken, igUserId } = options;
  const now = options.now ?? (() => new Date());
  const version = options.apiVersion ?? endpoints.graphApiVersion;
  const pageSize = options.pageSize ?? endpoints.graphPageSize;
  const redact = makeRedact(accessToken);
  const origin = `${endpoints.graphApiBase}/`;

  function firstUrl(handle: string, perPage: number): string {
    const media = `media.limit(${perPage}){${endpoints.businessDiscoveryMediaFields.join(",")}}`;
    const fields = `business_discovery.username(${handle}){${endpoints.businessDiscoveryProfileFields.join(",")},${media}}`;
    const query = new URLSearchParams({ fields, access_token: accessToken });
    return `${endpoints.graphApiBase}/${version}/${encodeURIComponent(igUserId)}?${query.toString()}`;
  }

  function fail(res: HttpResult, body: unknown): never {
    if (classifyHttp(res.status, res.text, res.location) === "blocked") {
      throw new SourceError("blocked", `Graph API refused the request (HTTP ${res.status})`);
    }
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    if (error) {
      const { failure, note } = graphFailure(error);
      const code = num(error.code);
      const detail = note ?? str(error.message) ?? "unknown error";
      throw new SourceError(
        failure,
        redact(`Graph API error ${code ?? "?"}: ${detail}`),
        res.retryAfterMs,
      );
    }
    const failure = classifyHttp(res.status, res.text, res.location) ?? "transport";
    throw new SourceError(failure, `Graph API HTTP ${res.status}`, res.retryAfterMs);
  }

  function getPage(url: string): Promise<Json> {
    return guard.run("graph_api", async () => {
      const res = await send(fetch, url, { accept: "application/json" }, redact);
      const body = tryParseJson(res.text);
      const hasError = isRecord(body) && isRecord(body.error);
      if (hasError || res.status < 200 || res.status >= 300) fail(res, body);
      if (!isRecord(body)) throw drift("body");
      return body;
    });
  }

  return {
    id: "graph_api",
    async fetchProfile(handleInput: string, opts: FetchOptions = {}): Promise<ProfileData> {
      const handle = normalizeHandle(handleInput);
      if (!handle) throw new SourceError("not_found", "Not a valid Instagram handle");
      if (!accessToken) throw new SourceError("unauthorized", "Graph API access token is missing");
      const { limit } = opts;
      const sinceMs = opts.since ? Date.parse(opts.since) : Number.NaN;
      const perPage = Math.max(1, Math.min(pageSize, limit ?? pageSize));
      const observedAt = now().toISOString();

      let url = firstUrl(handle, perPage);
      let profile: ProfileSnapshot | null = null;
      const posts: PostSnapshot[] = [];

      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await getPage(url);
        const bd = body.business_discovery;
        if (!isRecord(bd)) throw drift("business_discovery");
        profile ??= mapProfile(bd, observedAt);

        const media = bd.media;
        if (media !== undefined && (!isRecord(media) || !Array.isArray(media.data))) {
          throw drift("media.data");
        }
        let passedSince = false;
        for (const item of isRecord(media) && Array.isArray(media.data) ? media.data : []) {
          const post = mapMedia(item);
          if (!Number.isNaN(sinceMs) && Date.parse(post.postedAt) <= sinceMs) {
            passedSince = true;
            continue;
          }
          posts.push(post);
        }
        if (passedSince || (limit !== undefined && posts.length >= limit)) break;

        const paging = isRecord(media) ? media.paging : undefined;
        const next = isRecord(paging) ? str(paging.next) : null;
        if (!next) break;
        // The next URL carries the token: never send it anywhere but the Graph host.
        if (!next.startsWith(origin)) throw drift("paging.next host");
        url = next;
      }

      if (!profile) throw drift("empty response");
      return { profile, posts: limit === undefined ? posts : posts.slice(0, limit) };
    },
  };
}
