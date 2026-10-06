/** Jobs of the content module. The web app enqueues them; apps/worker runs `contentHandlers`. */
import { exportOutputs } from "@forgecy/carousel";
import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

const base = {
  clientId: z.uuid(),
  /** Person who asked: recorded as authorized_by in jobs_log. */
  requestedBy: z.uuid().nullish(),
};
const instruction = z.string().trim().max(500).default("");

/** Planner: pillars and rubrics as proposals. */
export const proposeStrategyJob = defineJob({
  kind: "content.propose_strategy",
  queue: "ai",
  payload: z.object({ ...base, instruction }),
});

/** Planner: a 30-day plan as a new proposed plan. */
export const proposePlanJob = defineJob({
  kind: "content.propose_plan",
  queue: "ai",
  payload: z.object({
    ...base,
    instruction,
    channels: z
      .array(z.enum(["instagram", "linkedin"]))
      .min(1)
      .max(2)
      .default(["instagram"]),
  }),
});

/** Copywriter: outline from the brief («Genera scaletta» / «Rigenera»). */
export const generateOutlineJob = defineJob({
  kind: "content.generate_outline",
  queue: "ai",
  payload: z.object({
    ...base,
    contentId: z.uuid(),
    instruction,
    /** «Mantieni le righe modificate a mano». */
    keepEdited: z.boolean().default(true),
  }),
});

/** Copywriter: slide texts from the approved outline. */
export const generateSlidesJob = defineJob({
  kind: "content.generate_slides",
  queue: "ai",
  payload: z.object({ ...base, contentId: z.uuid() }),
});

/** Copywriter: one slide rewritten from a person's instruction. */
export const editSlideJob = defineJob({
  kind: "content.edit_slide",
  queue: "ai",
  payload: z.object({
    ...base,
    contentId: z.uuid(),
    editId: z.uuid(),
  }),
});

/** Art Director + image provider: draft images for an image slot. */
export const generateImageJob = defineJob({
  kind: "content.generate_image",
  queue: "ai",
  payload: z.object({
    ...base,
    contentId: z.uuid(),
    slideId: z.string().min(1).max(64),
    slot: z.string().min(1).max(32),
    brief: z.string().trim().min(3).max(400),
    variants: z.number().int().min(1).max(4).default(2),
  }),
});

/** Export of a version through the carousel renderer, recorded on the content. */
export const exportContentJob = defineJob({
  kind: "content.export",
  queue: "export",
  payload: z.object({
    ...base,
    contentId: z.uuid(),
    versionId: z.uuid(),
    draft: z.boolean(),
    outputs: z.array(z.enum(exportOutputs)).min(1).default(["zip"]),
  }),
});

export const contentJobs = [
  proposeStrategyJob,
  proposePlanJob,
  generateOutlineJob,
  generateSlidesJob,
  editSlideJob,
  generateImageJob,
  exportContentJob,
] as const;
