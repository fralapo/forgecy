import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/** Builds the full package of one client (spec page 68) and stores the ZIP. */
export const clientExportJob = defineJob({
  kind: "client.export",
  queue: "export",
  payload: z.object({ exportId: z.uuid() }),
});

export const clientTransferJobs = [clientExportJob] as const;
