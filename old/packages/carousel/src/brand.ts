import { z } from "zod";
import { imageRefSchema } from "./slide-schema";
import { colorRoles, fontRoles, hexColorSchema } from "./template-schema";

/**
 * What the renderer needs from a Brand Identity: colors bound to semantic roles, the
 * heading and body fonts, logo and handle. M4 builds it from the published BI; a role
 * the brand leaves empty falls back to the template's own value.
 */
export const brandFontSchema = z.object({
  family: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\p{L}\p{N} _-]+$/u, "Font name: letters, digits, spaces and dashes"),
  /** Storage key of the font file (WOFF2/WOFF/TTF/OTF); omit to use a font of the template. */
  key: z.string().min(1).max(1024).optional(),
  weight: z
    .string()
    .regex(/^\d{3}( \d{3})?$/)
    .default("400"),
  style: z.enum(["normal", "italic"]).default("normal"),
});
export type BrandFont = z.infer<typeof brandFontSchema>;

export const brandThemeSchema = z.object({
  name: z.string().max(80).default(""),
  /** Social handle shown by templates that have a `data-fc="handle"` element. */
  handle: z.string().max(60).default(""),
  colors: z.partialRecord(z.enum(colorRoles), hexColorSchema).default({}),
  fonts: z.partialRecord(z.enum(fontRoles), brandFontSchema).default({}),
  logo: imageRefSchema.optional(),
  /** Brand Identity version, written in the export metadata. */
  version: z.string().max(40).optional(),
});
export type BrandTheme = z.infer<typeof brandThemeSchema>;
export type BrandThemeInput = z.input<typeof brandThemeSchema>;

/** “Neutral preview brand”: the template's own fallbacks, nothing else. */
export const NEUTRAL_BRAND: BrandTheme = brandThemeSchema.parse({ name: "Preview" });
