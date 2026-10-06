import { defineJob } from "@forgecy/jobs/registry";
import { z } from "zod";
import { brandThemeSchema } from "./brand";
import { slideSchema } from "./slide-schema";

export const exportOutputs = ["png", "pdf", "zip"] as const;
export type ExportOutput = (typeof exportOutputs)[number];

/**
 * What an export needs, frozen at enqueue time: the approved slides, the brand theme
 * and the template version. The payload lives in Postgres (jobs.payload), so the
 * export can be repeated later and give the same files.
 */
export const carouselExportPayloadSchema = z.object({
  clientId: z.uuid(),
  /** Display names; the file names are their slugs. */
  client: z.string().min(1).max(120),
  content: z.string().min(1).max(160),
  version: z.number().int().min(1),
  templateId: z.string().min(1).max(64),
  /** Pin a template version; omitted = the version the catalog serves now. */
  templateVersion: z.string().max(20).optional(),
  slides: z.array(slideSchema).min(1).max(20),
  brand: brandThemeSchema.default({ name: "", handle: "", colors: {}, fonts: {} }),
  /** The longest channel limit (LinkedIn); the content module checks each channel's own limit. */
  caption: z.string().max(3000).default(""),
  hashtags: z.array(z.string().max(100)).max(30).default([]),
  /** "zip" includes PNG, PDF, caption.txt, texts.md and slides.json. */
  outputs: z.array(z.enum(exportOutputs)).min(1).default(["zip"]),
  /** Before approval: “Draft” watermark and `_draft` file names. */
  draft: z.boolean().default(false),
  metadata: z
    .object({
      brandIdentityVersion: z.string().max(40).optional(),
      models: z.array(z.string().max(80)).max(10).optional(),
      approvedAt: z.iso.datetime().optional(),
    })
    .default({}),
});
export type CarouselExportPayload = z.output<typeof carouselExportPayloadSchema>;
export type CarouselExportPayloadInput = z.input<typeof carouselExportPayloadSchema>;

export const carouselExportJob = defineJob({
  kind: "carousel.export",
  queue: "export",
  payload: carouselExportPayloadSchema,
});

/** Validates a catalog template (static checks + test render) after an import; saves the report on the row. */
export const templateValidateJob = defineJob({
  kind: "carousel.validate_template",
  queue: "export",
  payload: z.object({ templateRowId: z.uuid() }),
});

export interface ExportedFile {
  name: string;
  key: string;
  contentType: string;
  size: number;
  sha256: string;
  kind: "png" | "pdf" | "zip";
}
