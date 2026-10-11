/**
 * Patterns of the copy lint, per language, as data. A language with no entry is not
 * linted. All regexes are case-insensitive and unicode-aware; a new language adds a block.
 */
export type AiTellKind = "dash" | "contrast" | "filler" | "pressRelease" | "gerund" | "closer";

export interface CopyPatterns {
  aiTells: Record<AiTellKind, readonly RegExp[]>;
  /** Forms of address that tell “tu” from “voi” (Italian). */
  person?: { tu: RegExp; voi: RegExp };
}

const flags = "iu";
const rx = (...sources: string[]) => sources.map((s) => new RegExp(s, flags));
// A dash used as a pause: spaced, or an em dash between words.
const dash = rx(String.raw`\s[—–]\s`, String.raw`\p{L}—\p{L}`, String.raw`\s-\s`);

export const COPY_PATTERNS: Record<string, CopyPatterns> = {
  it: {
    aiTells: {
      dash,
      contrast: rx(String.raw`non (?:è|sono|si tratta di) solo [^.!?\n]*?,\s*(?:è|sono|ma)(?!\p{L})`),
      filler: rx(
        String.raw`è importante (?:notare|sottolineare|ricordare) che`,
        String.raw`\bal fine di\b`,
        String.raw`\bva detto che\b`,
        String.raw`\bin un mondo (?:sempre più|in continua)`,
      ),
      pressRelease: rx(
        String.raw`\bleader del settore\b`,
        String.raw`\bsoluzioni innovative\b`,
        String.raw`\ball['’]avanguardia\b`,
        String.raw`\ba 360 gradi\b`,
        String.raw`\bsinergie?\b`,
      ),
      gerund: rx(String.raw`,\s+\p{L}+(?:ando|endo)\b[^.!?\n]*[.!?]`),
      closer: rx(
        String.raw`\bil futuro è (?:già )?(?:qui|luminoso)`,
        String.raw`\binsieme (?:possiamo|verso)\b`,
        String.raw`\bpronti a (?:iniziare|scoprire|partire)\b`,
      ),
    },
    person: {
      tu: /\b(?:tu|tuo|tua|tuoi|tue|ti|hai|puoi|devi|vuoi)\b/iu,
      voi: /\b(?:voi|vostro|vostra|vostri|vostre|vi|avete|potete|dovete|volete)\b/iu,
    },
  },
  en: {
    aiTells: {
      dash,
      contrast: rx(String.raw`not (?:just|only|merely) [^.!?\n]*?,\s*(?:it['’]s|it is|but)\b`),
      filler: rx(
        String.raw`it(?:['’]s| is) (?:important|worth) (?:to note|noting) that`,
        String.raw`\bin order to\b`,
        String.raw`\bin today['’]s (?:fast-paced|digital) world\b`,
        String.raw`\bit goes without saying\b`,
      ),
      pressRelease: rx(
        String.raw`\bcutting-edge\b`,
        String.raw`\bgame-changing\b`,
        String.raw`\bstate-of-the-art\b`,
        String.raw`\bworld-class\b`,
        String.raw`\bleverag(?:e|es|ing)\b`,
        String.raw`\bsynerg(?:y|ies)\b`,
        String.raw`\bseamless(?:ly)?\b`,
      ),
      gerund: rx(String.raw`,\s+\p{L}+ing\b[^.!?\n]*[.!?]`),
      closer: rx(
        String.raw`\bthe future is (?:bright|here)\b`,
        String.raw`\blet['’]s (?:build|shape) the future together\b`,
        String.raw`\bexciting times (?:are )?ahead\b`,
      ),
    },
  },
};

/** Marks of unfinished copy: they belong in the notes, never in a slide or the caption. */
export const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\[[^\]\n]*(?:da confermare|to be confirmed|tbc|tbd|todo|da completare)[^\]\n]*\]/iu,
  /\{\{[^}\n]*\}\}/u,
  /\b(?:TODO|TBD|TBC)\b/u,
  /\blorem ipsum\b/iu,
  /\bX{3,}\b/u,
];
