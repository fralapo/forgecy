import { z } from "zod";

/**
 * Output formats in release order (spec "Formati"): Instagram 4:5 and the LinkedIn
 * document ship in the MVP; the others are v1 and become usable as soon as a
 * template declares them. Sizes are real pixels: the renderer never scales.
 * The report formats (audit, A4 and 16:9) are paged PDFs with no social channel.
 */
export const formatIds = [
  "ig_4x5",
  "linkedin_doc",
  "ig_1x1",
  "stories_9x16",
  "fb_4x5",
  "tiktok_photo",
  "report_a4",
  "report_16x9",
] as const;
export type FormatId = (typeof formatIds)[number];
export const formatIdSchema = z.enum(formatIds);

export const channels = ["instagram", "linkedin", "facebook", "tiktok"] as const;
export type Channel = (typeof channels)[number];

export const safeZoneSchema = z.object({
  top: z.number().int().min(0).max(600),
  right: z.number().int().min(0).max(600),
  bottom: z.number().int().min(0).max(600),
  left: z.number().int().min(0).max(600),
});
export type SafeZone = z.infer<typeof safeZoneSchema>;

export interface FormatSpec {
  id: FormatId;
  label: string;
  /** Social channel; null for reports, which are not published anywhere. */
  channel: Channel | null;
  /** What the template is: a social carousel or a paged report. */
  kind: "carousel" | "report";
  width: number;
  height: number;
  /** Used in export file names: `{cliente}_{contenuto}_v{n}_{fileSlug}_{nn}.png`. */
  fileSlug: string;
  /** Default safe zone in px; a template can override it. */
  safeZone: SafeZone;
  /** The PDF is the deliverable (LinkedIn document); for the others it's the PNGs. */
  primaryOutput: "png" | "pdf";
  /** Print resolution: the PDF page is sized in points from it (A4 at 150 dpi = 595×842 pt). */
  dpi?: number;
  phase: "mvp" | "v1";
}

export const FORMATS: Readonly<Record<FormatId, FormatSpec>> = {
  ig_4x5: {
    id: "ig_4x5",
    label: "Instagram 4:5",
    channel: "instagram",
    kind: "carousel",
    width: 1080,
    height: 1350,
    fileSlug: "ig-4x5",
    safeZone: { top: 80, right: 64, bottom: 120, left: 64 },
    primaryOutput: "png",
    phase: "mvp",
  },
  linkedin_doc: {
    id: "linkedin_doc",
    label: "LinkedIn document",
    channel: "linkedin",
    kind: "carousel",
    width: 1080,
    height: 1350,
    fileSlug: "linkedin-doc",
    safeZone: { top: 72, right: 72, bottom: 96, left: 72 },
    primaryOutput: "pdf",
    phase: "mvp",
  },
  ig_1x1: {
    id: "ig_1x1",
    label: "Instagram 1:1",
    channel: "instagram",
    kind: "carousel",
    width: 1080,
    height: 1080,
    fileSlug: "ig-1x1",
    safeZone: { top: 64, right: 64, bottom: 96, left: 64 },
    primaryOutput: "png",
    phase: "v1",
  },
  stories_9x16: {
    id: "stories_9x16",
    label: "Stories 9:16",
    channel: "instagram",
    kind: "carousel",
    width: 1080,
    height: 1920,
    fileSlug: "stories-9x16",
    // Profile header on top, reply bar at the bottom.
    safeZone: { top: 250, right: 64, bottom: 340, left: 64 },
    primaryOutput: "png",
    phase: "v1",
  },
  fb_4x5: {
    id: "fb_4x5",
    label: "Facebook 4:5",
    channel: "facebook",
    kind: "carousel",
    width: 1080,
    height: 1350,
    fileSlug: "fb-4x5",
    safeZone: { top: 80, right: 64, bottom: 120, left: 64 },
    primaryOutput: "png",
    phase: "v1",
  },
  tiktok_photo: {
    id: "tiktok_photo",
    label: "TikTok foto",
    channel: "tiktok",
    kind: "carousel",
    width: 1080,
    height: 1920,
    fileSlug: "tiktok-photo",
    // Caption and action buttons cover the bottom and the right edge.
    safeZone: { top: 160, right: 140, bottom: 480, left: 64 },
    primaryOutput: "png",
    phase: "v1",
  },
  report_a4: {
    id: "report_a4",
    label: "Report A4",
    channel: null,
    kind: "report",
    width: 1240,
    height: 1754,
    fileSlug: "report-a4",
    // 15 mm margins at 150 dpi, a little more at the bottom for the footer.
    safeZone: { top: 88, right: 88, bottom: 104, left: 88 },
    primaryOutput: "pdf",
    dpi: 150,
    phase: "mvp",
  },
  report_16x9: {
    id: "report_16x9",
    label: "Report 16:9",
    channel: null,
    kind: "report",
    width: 1920,
    height: 1080,
    fileSlug: "report-16x9",
    safeZone: { top: 72, right: 96, bottom: 80, left: 96 },
    primaryOutput: "pdf",
    phase: "mvp",
  },
};

/** PDF page size in points: real print size when the format has a dpi, else 1 px = 1 pt. */
export function pdfPageSize(id: FormatId): { width: number; height: number } {
  const f = FORMATS[id];
  const k = f.dpi ? 72 / f.dpi : 1;
  return { width: f.width * k, height: f.height * k };
}

/** "Instagram 4:5 · 1080×1350" */
export function describeFormat(id: FormatId): string {
  const f = FORMATS[id];
  return `${f.label} · ${f.width}×${f.height}`;
}
