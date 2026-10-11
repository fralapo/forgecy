/** Pure lints of slide and caption copy; the checks wrap them with ids, severity and messages. */
import { COPY_PATTERNS, PLACEHOLDER_PATTERNS, type AiTellKind } from "./copy-patterns";

export interface AiTell {
  kind: AiTellKind;
  match: string;
}

/** The first match of each kind of machine-written tell in `text`, in the given language. */
export function findAiTells(text: string, language: string): AiTell[] {
  const set = COPY_PATTERNS[language]?.aiTells;
  if (!set) return [];
  const out: AiTell[] = [];
  for (const [kind, patterns] of Object.entries(set) as [AiTellKind, readonly RegExp[]][])
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) {
        out.push({ kind, match: m[0].trim() });
        break;
      }
    }
  return out;
}

/** The first placeholder marker in `text` (“[da confermare]”, TODO, lorem ipsum, {{x}}), if any. */
export function findPlaceholder(text: string): string | null {
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** Distinct hashtags of the list and of the caption body, without “#”, lowercased. */
export function hashtagSet(hashtags: readonly string[], caption: string): Set<string> {
  const tags = [...hashtags, ...(caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])];
  return new Set(tags.map((t) => t.replace(/^#/, "").toLowerCase()));
}

/** True when `credit` appears in the caption and before the first hashtag typed in it. */
export function creditBeforeHashtags(caption: string, credit: string): boolean {
  const at = caption.toLowerCase().indexOf(credit.trim().toLowerCase());
  if (at < 0) return false;
  const tag = caption.search(/#[\p{L}\p{N}_]/u);
  return tag < 0 || at < tag;
}

/** The form of address a text uses, when it uses exactly one of “tu” or “voi” (Italian). */
export function addressForm(text: string, language: string): "tu" | "voi" | null {
  const p = COPY_PATTERNS[language]?.person;
  if (!p) return null;
  const tu = p.tu.test(text);
  const voi = p.voi.test(text);
  return tu === voi ? null : tu ? "tu" : "voi";
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Runs of `min` or more consecutive dense slides: the reader needs a breather. `dense`
 * flags each slide in order; returns the 0-based `[from, to]` of every such run.
 */
export function denseRuns(dense: readonly boolean[], min = 4): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= dense.length; i++) {
    if (dense[i]) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= min) runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}
