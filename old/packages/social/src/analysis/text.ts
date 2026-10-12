// Same tokens Instagram links: letters, digits and underscore after # or @, any script.
const HASHTAG = /(?<![\p{L}\p{N}_&])#([\p{L}\p{N}_]{1,100})/gu;
const MENTION = /(?<![\p{L}\p{N}_.@])@([a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?)/giu;

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

/** Lowercase hashtags without "#", in order of first appearance, no duplicates. */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  return unique([...text.matchAll(HASHTAG)].map((m) => m[1]!.normalize("NFKC").toLowerCase()));
}

/** Lowercase handles without "@", in order of first appearance, no duplicates. */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  return unique([...text.matchAll(MENTION)].map((m) => m[1]!.toLowerCase()));
}

/** "@Name" / "https://www.instagram.com/name/?hl=it" / "name" to "name", or null. */
export function normalizeHandle(input: string): string | null {
  let v = input.trim();
  const url = v.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i);
  if (url) v = url[1]!;
  v = v.replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(v) ? v : null;
}
