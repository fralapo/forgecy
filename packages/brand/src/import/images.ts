/**
 * Images found on a client's own website, copied into the asset library (and the logo also
 * into the brand sources, where a logo variant can point to it). The page is untrusted: every
 * download is pinned to a public address, capped, sniffed from its bytes and measured after
 * decoding, never from the HTML attributes.
 */
import type { AiGateway } from "@forgecy/ai";
import { createHostCheck, createPinnedFetch, type ProbeImage } from "@forgecy/audit";
import { auditUserAgent } from "@forgecy/audit/crawl/fetcher";
import { can } from "@forgecy/core";
import { guardedFetch, readCapped, type HostCheck } from "@forgecy/core/net-guard";
import { and, assets, brandSources, eq, isNull, userActor, type Database } from "@forgecy/db";
import { contentKey, sha256, validateUpload, type StorageDriver } from "@forgecy/files";
import sharp from "sharp";

export type ImageClass = "product" | "scene" | "graphic" | "logo";

export const IMAGE_LIMITS = {
  /** Images saved per harvest; the logo is extra. */
  max: 12,
  minSide: 200,
  fileBytes: 8 * 1024 * 1024,
  totalBytes: 40 * 1024 * 1024,
  timeoutMs: 10_000,
} as const;

/** A decompression bomb is a small file that decodes to billions of pixels; sharp refuses past this. */
export const MAX_INPUT_PIXELS = 50_000_000;
const SHARP_INPUT = { limitInputPixels: MAX_INPUT_PIXELS } as const;

/** Candidates downloaded per round: bounded parallelism, results are still applied in order. */
const BATCH = 4;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

// ---- classification ----

export interface ImageFacts {
  w: number;
  h: number;
  alt: string;
  url: string;
  mime: string;
  whiteBorderRatio: number;
  paletteSize: number;
}

/** A rule of thumb, not a verdict: the class is a tag a person can read and change. */
export function classifyImageHeuristic(i: ImageFacts): ImageClass {
  if (/logo/i.test(i.url) || /logo/i.test(i.alt)) return "logo";
  if (i.mime === "image/svg+xml") return "graphic";
  if (i.whiteBorderRatio > 0.85) return "product";
  if (i.paletteSize <= 8) return "graphic";
  // Many colors: a wide frame is a photographed scene, anything else a subject on its own.
  if (i.paletteSize >= 24) return i.h > 0 && i.w / i.h >= 1.2 ? "scene" : "product";
  return "graphic";
}

const NEAR_WHITE = 240;
const SAMPLE = 64;
/** A color only counts when it covers this share of the sample, so anti-aliasing does not inflate it. */
const MIN_COLOR_SHARE = 0.005;

/** Real size plus the two numbers the heuristic needs, from a 64 px copy of the image. */
export async function describeImage(
  bytes: Uint8Array,
): Promise<{ w: number; h: number; whiteBorderRatio: number; paletteSize: number }> {
  const meta = await sharp(bytes, SHARP_INPUT).metadata();
  const { data, info } = await sharp(bytes, SHARP_INPUT)
    .flatten({ background: "#ffffff" })
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let border = 0;
  let white = 0;
  const buckets = new Map<number, number>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      const r = data[o]!;
      const g = data[o + 1]!;
      const b = data[o + 2]!;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        border++;
        if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) white++;
      }
    }
  const minCount = width * height * MIN_COLOR_SHARE;
  return {
    w: meta.width ?? width,
    h: meta.height ?? height,
    whiteBorderRatio: border ? white / border : 0,
    paletteSize: [...buckets.values()].filter((n) => n >= minCount).length,
  };
}

// ---- svg ----

const SVG_UNSAFE = [
  /<script/i,
  /[\s"'/]on[a-z]+\s*=/i,
  /javascript:/i,
  /<foreignObject/i,
  /<(?:iframe|embed|object)\b/i,
  /<!ENTITY/i,
  /(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
  /@import/i,
];

/** SVG is stored as is, never rasterized: refuse anything that can run code or call out. */
export const svgIsSafe = (text: string) => !SVG_UNSAFE.some((re) => re.test(text));

/** Size from viewBox, else width/height; {0,0} when the file does not say. */
export function svgSize(text: string): { w: number; h: number } {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
  const attr = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
  const box = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2]! > 0 && box[3]! > 0) return { w: box[2]!, h: box[3]! };
  const num = (v: string | undefined) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0);
  return { w: num(attr("width")), h: num(attr("height")) };
}

// ---- download ----

interface Downloaded {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

interface NetDeps {
  hostCheck: HostCheck;
  fetchImpl: typeof fetch;
}

/** Null for anything wrong: a refused host, a bad status, a wrong or lying type, or too big. */
async function download(url: string, net: NetDeps): Promise<Downloaded | null> {
  try {
    const target = new URL(url);
    // No file:, data: and the like, and no user:password@ riding along to a third party.
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) return null;
    const { res } = await guardedFetch(url, {
      hostCheck: net.hostCheck,
      fetchImpl: net.fetchImpl,
      timeoutMs: IMAGE_LIMITS.timeoutMs,
      headers: { accept: "image/*", "user-agent": auditUserAgent() },
    });
    const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const length = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !ALLOWED_TYPES.has(declared) || length > IMAGE_LIMITS.fileBytes) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const { bytes, truncated } = await readCapped(res, IMAGE_LIMITS.fileBytes);
    if (truncated) return null;
    // The header only gets a file past the door; what it is comes from its first bytes.
    const real = validateUpload({
      kind: "image",
      mime: "",
      size: bytes.length,
      firstBytes: bytes.subarray(0, 1024),
      allowSvg: true,
    });
    if (!real.ok) return null;
    if (real.mime === "image/svg+xml" && !svgIsSafe(new TextDecoder().decode(bytes))) return null;
    return { bytes, mime: real.mime, ext: real.ext };
  } catch {
    return null;
  }
}

// ---- storage ----

/** Same shape the asset library writes for an upload (packages/content/src/assets.ts AssetRights). */
function siteRights(confirmedBy: string, pageUrl: string) {
  return {
    // The person who started the import attests the file comes from the client's own site.
    basis: "client_supplied" as const,
    note: `Imported from the client's website: ${pageUrl}`,
    confirmedBy,
    confirmedAt: new Date().toISOString(),
  };
}

export interface HarvestDeps {
  db: Database;
  storage: StorageDriver;
  /** Reserved for classifying ambiguous images with a vision model; the heuristic is all that runs today. */
  ai?: AiGateway | null;
}

export interface HarvestInput {
  clientId: string;
  /** The website source: its address is the provenance written on each image. */
  sourceId: string;
  images: ProbeImage[];
  /** Logo candidates, best first: the first one that downloads and validates is kept. */
  logos?: ProbeImage[];
  max?: number;
  /** Replaces the class and "site" tags, for pictures that are not the site's own (a social profile image). */
  tags?: string[];
  /**
   * The image is not the client's own site content (a social profile picture): the requester is
   * recorded as its creator, but nobody has attested the rights, so it stays a draft.
   */
  unattested?: boolean;
  /** Smallest side kept for a content image (a profile picture is small by nature). */
  minSide?: number;
  /** The person who started the import; they attest the rights. Null: images wait for a person. */
  requestedBy?: string | null;
  allowPrivate?: boolean;
  /** Override for tests; defaults to the guard the crawl uses. */
  hostCheck?: HostCheck;
  fetchImpl?: typeof fetch;
}

export interface HarvestResult {
  saved: number;
  skipped: number;
  /** Files that were fine but could not be registered (database or storage error). */
  failed: number;
  /** The brand source holding the logo file, and the probe entry it came from. */
  logo?: { sourceId: string; image: ProbeImage };
}

type Stored = { id: string; created: boolean; sha256: string };

export async function harvestImages(
  deps: HarvestDeps,
  input: HarvestInput,
): Promise<HarvestResult> {
  const { db, storage } = deps;
  const net: NetDeps = {
    hostCheck: input.hostCheck ?? createHostCheck({ allowPrivate: !!input.allowPrivate }),
    fetchImpl: input.fetchImpl ?? createPinnedFetch({ allowPrivate: !!input.allowPrivate }),
  };
  const [site] = await db
    .select({ url: brandSources.url })
    .from(brandSources)
    .where(and(eq(brandSources.id, input.sourceId), eq(brandSources.clientId, input.clientId)));
  const pageUrl = site?.url ?? "";
  // A requester who no longer exists would fail every insert (foreign key): keep the images, unattributed.
  const who = input.requestedBy ? await userActor(db, input.requestedBy).catch(() => null) : null;
  const requestedBy = who?.id ?? null;
  const max = input.max ?? IMAGE_LIMITS.max;
  // Only someone who may upload to this client right now (active, with access) attests the
  // rights; anyone else's images wait as drafts for a person who may.
  const attested = !!who && can(who, "assets.upload", input.clientId) && !input.unattested;
  let totalBytes = 0;

  /** Measures, classifies and registers one downloaded file. Null: not usable or already there. */
  async function store(
    file: Downloaded,
    image: ProbeImage,
    isLogo: boolean,
  ): Promise<Stored | null> {
    const svg = file.mime === "image/svg+xml";
    let look: Awaited<ReturnType<typeof describeImage>>;
    try {
      look = svg
        ? { ...svgSize(new TextDecoder().decode(file.bytes)), whiteBorderRatio: 0, paletteSize: 0 }
        : await describeImage(file.bytes);
    } catch {
      return null; // looked like an image and does not decode
    }
    const { w, h, whiteBorderRatio, paletteSize } = look;
    // The size on the page is what the browser drew; only the decoded one counts here.
    const min = isLogo ? 16 : (input.minSide ?? IMAGE_LIMITS.minSide);
    if (!svg && (w < min || h < min)) return null;
    if (totalBytes + file.bytes.length > IMAGE_LIMITS.totalBytes) return null;

    const hash = sha256(file.bytes);
    const [existing] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.clientId, input.clientId), eq(assets.sha256, hash)));
    if (existing) return { id: existing.id, created: false, sha256: hash };

    const cls = isLogo
      ? "logo"
      : classifyImageHeuristic({
          w,
          h,
          alt: image.alt,
          url: image.url,
          mime: file.mime,
          whiteBorderRatio,
          paletteSize,
        });
    const key = contentKey({
      clientId: input.clientId,
      scope: "assets",
      sha256: hash,
      ext: file.ext,
    });
    if (!(await storage.exists(key)))
      await storage.put(key, file.bytes, {
        contentType: file.mime,
        contentLength: file.bytes.length,
      });
    const now = new Date();
    const [row] = await db
      .insert(assets)
      .values({
        clientId: input.clientId,
        source: "site",
        status: attested ? "approved" : "draft",
        storageKey: key,
        sha256: hash,
        mime: file.mime,
        size: file.bytes.length,
        width: w || null,
        height: h || null,
        alt: image.alt.trim().slice(0, 300),
        tags: input.tags ?? [cls, "site"],
        rights: attested ? siteRights(requestedBy!, pageUrl) : null,
        createdBy: requestedBy,
        ...(attested ? { decidedBy: requestedBy!, decidedAt: now } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: assets.id });
    if (!row) return null; // another run saved the same bytes first
    totalBytes += file.bytes.length;
    return { id: row.id, created: true, sha256: hash };
  }

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let logo: HarvestResult["logo"];

  // The logo goes first so that, when the same file also sits among the images, it keeps the logo tag.
  for (const candidate of input.logos ?? []) {
    const file = await download(candidate.url, net);
    if (!file) continue;
    try {
      const stored = await store(file, candidate, true);
      if (!stored) continue;
      if (stored.created) saved++;
      logo = {
        sourceId: await logoSource(
          db,
          storage,
          input.clientId,
          pageUrl,
          candidate,
          file,
          requestedBy,
        ),
        image: candidate,
      };
      break;
    } catch {
      failed++; // the next candidate is tried
    }
  }

  const queue = [...new Map(input.images.map((i) => [i.url, i])).values()].slice(0, max * 3);
  let savedImages = 0;
  for (let at = 0; at < queue.length && savedImages < max; at += BATCH) {
    const batch = queue.slice(at, at + BATCH);
    const files = await Promise.all(batch.map((i) => download(i.url, net)));
    for (const [n, image] of batch.entries()) {
      const file = files[n];
      if (savedImages >= max) break;
      let stored: Stored | null = null;
      try {
        stored = file ? await store(file, image, false) : null;
      } catch {
        failed++; // the other images are still tried
      }
      if (stored?.created) {
        saved++;
        savedImages++;
      } else skipped++;
    }
  }
  return { saved, skipped, failed, ...(logo ? { logo } : {}) };
}

/** The logo as a brand source, so a logo variant can point to it; the same file is registered once. */
async function logoSource(
  db: Database,
  storage: StorageDriver,
  clientId: string,
  pageUrl: string,
  image: ProbeImage,
  file: Downloaded,
  requestedBy: string | null,
): Promise<string> {
  const hash = sha256(file.bytes);
  const find = async () =>
    (
      await db
        .select({ id: brandSources.id })
        .from(brandSources)
        .where(
          and(
            eq(brandSources.clientId, clientId),
            eq(brandSources.sha256, hash),
            isNull(brandSources.removedAt),
          ),
        )
    )[0]?.id;
  const existing = await find();
  if (existing) return existing;
  const key = contentKey({ clientId, scope: "brand-sources", sha256: hash, ext: file.ext });
  if (!(await storage.exists(key)))
    await storage.put(key, file.bytes, {
      contentType: file.mime,
      contentLength: file.bytes.length,
    });
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    // The title just goes without a host.
  }
  const [row] = await db
    .insert(brandSources)
    .values({
      clientId,
      kind: "screenshot",
      title: `Logo ${host}`.trim().slice(0, 300),
      url: image.url,
      storageKey: key,
      mime: file.mime,
      size: file.bytes.length,
      sha256: hash,
      // A file source starts "pending" for the extraction job; nothing needs to read this one.
      status: "extracted",
      createdBy: requestedBy,
    })
    .onConflictDoNothing()
    .returning({ id: brandSources.id });
  return row?.id ?? (await find())!;
}
