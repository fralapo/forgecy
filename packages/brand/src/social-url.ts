/** Which links are public social profiles, and their canonical form. Pure. */
import { socialChannelOf } from "@forgecy/audit";
import { socialChannels, type SocialChannel } from "@forgecy/core";

export type SocialKind = SocialChannel;

export const isSocialKind = (kind: string): kind is SocialKind =>
  (socialChannels as readonly string[]).includes(kind);

const ROOT: Record<SocialKind, string> = {
  instagram: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  linkedin: "https://www.linkedin.com",
  tiktok: "https://www.tiktok.com",
};

/** First path segments of a platform that are features, posts or share dialogs, never a profile. */
const NOT_A_PROFILE: Record<"instagram" | "facebook", Set<string>> = {
  instagram: new Set(
    "p reel reels tv explore accounts stories direct about legal developer challenge web share login directory privacy press api emails oauth".split(
      " ",
    ),
  ),
  facebook: new Set(
    "sharer sharer.php share share.php dialog plugins login login.php groups events watch marketplace gaming hashtag photo photo.php permalink.php story.php policies privacy help tr l.php recover reg public people".split(
      " ",
    ),
  ),
};

/** The profile a link points to, in one canonical form (no query, no hash, no trailing slash). */
export function socialProfileOf(url: string): { kind: SocialKind; url: string } | null {
  const kind = socialChannelOf(url);
  if (!kind) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const first = (parts[0] ?? "").toLowerCase();
  let path: string | null = null;
  switch (kind) {
    case "instagram":
      if (
        parts.length === 1 &&
        /^[a-z0-9._]{1,30}$/.test(first) &&
        !NOT_A_PROFILE.instagram.has(first)
      )
        path = `/${first}`;
      break;
    case "facebook":
      if (first === "profile.php" && /^\d+$/.test(u.searchParams.get("id") ?? ""))
        return { kind, url: `${ROOT.facebook}/profile.php?id=${u.searchParams.get("id")}` };
      if (first === "pages" && parts.length >= 3)
        path = `/${parts.slice(0, 3).join("/").toLowerCase()}`;
      else if (
        parts.length === 1 &&
        /^[a-z0-9.-]{3,}$/.test(first) &&
        !NOT_A_PROFILE.facebook.has(first)
      )
        path = `/${first}`;
      break;
    case "linkedin":
      if (["company", "in", "school", "showcase"].includes(first) && parts.length >= 2)
        path = `/${first}/${parts[1]!.toLowerCase()}`;
      break;
    case "tiktok":
      if (parts.length === 1 && /^@[a-z0-9._]{1,40}$/.test(first)) path = `/${first}`;
      break;
  }
  return path ? { kind, url: `${ROOT[kind]}${path}` } : null;
}

/** The platform of a profile link; null for anything else (share, intent or post links included). */
export const socialKindOf = (url: string): SocialKind | null => socialProfileOf(url)?.kind ?? null;
