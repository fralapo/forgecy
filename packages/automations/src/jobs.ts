/** Jobs of the automations module. apps/worker runs `automationHandlers`. */
import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/** One carousel of a run: create the draft, generate the outline, then the slides if asked. */
export const automationItemJob = defineJob({
  kind: "automation.item",
  queue: "ai",
  payload: z.object({ runItemId: z.uuid() }),
});
