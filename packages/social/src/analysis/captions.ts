import type { PostSnapshot } from "../types";
import { mean, median } from "./engagement";
import type { CaptionStats } from "./types";

const CTA =
  /link in bio|\bscopri|\bcontatt|\bprenot|\bacquista|\bscrivici|\bchiama|\biscriv|\bscarica|\brichied|\bvisita|shop now|learn more|\bbook\b|\bdm\b|\bcomment|tag a friend|\btagga/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;
const WORD = /\p{L}+/gu;

// Words that exist in one language only ("a", "in", "no" are left out on purpose).
const IT = new Set(
  "il lo la gli le un una uno di del della dei delle che per con non sono è e ma come più anche questo questa nel nella sul alla dal siamo hai ho ci vi se mi ti si da al".split(
    " ",
  ),
);
const EN = new Set(
  "the and of to is you your for with this that are we our it on at be have from but not or by an as was will can".split(
    " ",
  ),
);

/** "it" / "en" when one language's stopwords outnumber the other's, null when undecidable. */
function captionLanguage(caption: string): "it" | "en" | null {
  let it = 0;
  let en = 0;
  for (const m of caption.toLowerCase().matchAll(WORD)) {
    if (IT.has(m[0])) it += 1;
    if (EN.has(m[0])) en += 1;
  }
  if (it === en) return null;
  return it > en ? "it" : "en";
}

export function captionStats(posts: PostSnapshot[]): CaptionStats {
  const captions = posts
    .map((p) => p.caption)
    .filter((c): c is string => c !== null && c.trim() !== "");
  const n = captions.length;
  const share = (count: number) => (n === 0 ? null : count / n);

  const emojis = captions.map((c) => (c.match(EMOJI) ?? []).length);
  const langs = captions.map(captionLanguage).filter((l) => l !== null);
  const it = langs.filter((l) => l === "it").length;
  const en = langs.length - it;

  let language: CaptionStats["language"] = "unknown";
  if (langs.length > 0) {
    language = it / langs.length >= 0.7 ? "it" : en / langs.length >= 0.7 ? "en" : "mixed";
  }

  return {
    postsWithCaption: n,
    avgLength: mean(captions.map((c) => [...c].length)),
    medianLength: median(captions.map((c) => [...c].length)),
    ctaShare: share(captions.filter((c) => CTA.test(c)).length),
    questionShare: share(captions.filter((c) => c.includes("?")).length),
    emojiShare: share(emojis.filter((e) => e > 0).length),
    avgEmojis: mean(emojis),
    language,
  };
}
