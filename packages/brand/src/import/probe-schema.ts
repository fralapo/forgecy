/**
 * Shape of `brand_sources.visual` (a SiteProbe from @forgecy/audit). The column is free jsonb, so
 * what is read back is checked here; limits mirror the ones buildSiteProbe/mergeProbes apply.
 * Unknown keys are ignored, a wrong type or a list over its limit invalidates the whole value.
 */
import type { SiteProbe } from "@forgecy/audit";
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const image = z.object({
  url: z.string().max(2048),
  alt: z.string().max(200),
  w: z.number().min(0),
  h: z.number().min(0),
  inHeader: z.boolean(),
  inFooter: z.boolean(),
  repeats: z.number().min(0),
  source: z.enum(["img", "css-bg", "og", "icon", "jsonld"]),
});

export const siteProbeSchema = z.object({
  cssVars: z.array(z.object({ name: z.string().max(100), hex })).max(40),
  themeColor: hex.optional(),
  buttonColors: z
    .array(z.object({ hex, role: z.enum(["bg", "text"]), weight: z.number().min(0) }))
    .max(24),
  fonts: z
    .array(
      z.object({
        family: z.string().min(1).max(200),
        roles: z.array(z.enum(["headings", "body", "button"])).max(3),
        loaded: z.boolean(),
      }),
    )
    .max(12),
  logos: z.array(image).max(8),
  images: z.array(image).max(60),
  organization: z
    .object({
      name: z.string().max(200).optional(),
      logo: z.string().max(2048).optional(),
      sameAs: z.array(z.string().max(2048)).max(20),
      description: z.string().max(1000).optional(),
    })
    .optional(),
  siteName: z.string().max(200).optional(),
});

/** The stored probe, or undefined when the column is empty or no longer has the expected shape. */
export function parseSiteProbe(value: unknown): SiteProbe | undefined {
  const parsed = siteProbeSchema.safeParse(value);
  return parsed.success ? (parsed.data as SiteProbe) : undefined;
}
