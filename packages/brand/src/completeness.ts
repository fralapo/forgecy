/**
 * Completeness of a brand profile, as shown on the brand page: nine sections, each filled or
 * not. Pure: the page passes the shown version and how many brand images the client has.
 */
import type { BrandIdentityDocument } from "./document";
import { defaultTokens, referenceColors, type TokenTree } from "./tokens";

export const completenessSections = [
  "about",
  "tagline",
  "audience",
  "tone",
  "aesthetics",
  "fonts",
  "palette",
  "logo",
  "images",
] as const;
export type CompletenessSection = (typeof completenessSections)[number];

export interface BrandCompleteness {
  filled: number;
  total: 9;
  sections: Array<{ key: CompletenessSection; filled: boolean }>;
  /** Rounded: 8 of 9 is 89. */
  percent: number;
}

/** Palette needs this many colors of the brand's own. */
const MIN_COLORS = 3;
/** Images needs this many pictures in the brand image library. */
const MIN_IMAGES = 3;

/** The neutral colors a new identity starts with; they only count once a source or person touched them. */
const startingColors = referenceColors(defaultTokens());
const isStarting = (c: ReturnType<typeof referenceColors>[number]) =>
  !c.extension?.sourceIds?.length &&
  !c.extension?.acceptedFromProposalId &&
  startingColors.some((s) => s.name === c.name && s.hex === c.hex);

export function brandCompleteness(
  doc: BrandIdentityDocument,
  tokens: TokenTree,
  imageCount: number,
): BrandCompleteness {
  const v = doc.visual;
  const rule: Record<CompletenessSection, boolean> = {
    // About: the one-liner or the positioning statement.
    about: !!doc.strategy.oneLiner || !!doc.strategy.positioning,
    // Tagline: the one-liner.
    tagline: !!doc.strategy.oneLiner,
    // Audience: at least one segment still in use.
    audience: doc.strategy.audience.some((a) => !a.deprecated),
    // Tone: at least one tone axis.
    tone: doc.verbal.toneAxes.length > 0,
    // Aesthetics: the imagery description, or at least one visual do/don't.
    aesthetics: !!v.imagery || v.do.length > 0 || v.dont.length > 0,
    // Fonts: at least one typography role.
    fonts: v.typography.length > 0,
    // Palette: at least three reference colors, not counting the untouched starting ones.
    palette: referenceColors(tokens).filter((c) => !isStarting(c)).length >= MIN_COLORS,
    // Logo: at least one logo variant.
    logo: v.logo.variants.length > 0,
    // Images: at least three pictures in the brand image library.
    images: imageCount >= MIN_IMAGES,
  };
  const sections = completenessSections.map((key) => ({ key, filled: rule[key] }));
  const filled = sections.filter((s) => s.filled).length;
  return { filled, total: 9, sections, percent: Math.round((filled / 9) * 100) };
}
