import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/**
 * PDF of a client-facing Brand Book with the agency's "Brand Book" template
 * (renderer of M3). A preview carries the "Draft" watermark; the final one is
 * rendered only after a person approved the preview.
 */
export const brandBookRenderJob = defineJob({
  kind: "brand_book.render",
  queue: "export",
  payload: z.object({ exportId: z.uuid(), final: z.boolean() }),
});

export const brandBookJobs = [brandBookRenderJob] as const;
