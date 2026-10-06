import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/** Builds the full package of one client (spec page 68) and stores the ZIP. */
export const clientExportJob = defineJob({
  kind: "client.export",
  queue: "export",
  payload: z.object({ exportId: z.uuid() }),
});

/** Reads and checks an uploaded package (Verify step); writes only the import row. */
export const clientImportVerifyJob = defineJob({
  kind: "client.import.verify",
  queue: "export",
  payload: z.object({ importId: z.uuid() }),
});

/** Writes a confirmed import (after a backup when it replaces a client). */
export const clientImportJob = defineJob({
  kind: "client.import",
  queue: "export",
  payload: z.object({ importId: z.uuid() }),
});

export const clientTransferJobs = [
  clientExportJob,
  clientImportVerifyJob,
  clientImportJob,
] as const;
