import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/**
 * One job per import step: "scan" expands archives and reads sheet headers (stops in
 * needs_mapping when a sheet has no confirmed mapping), "extract" builds the products
 * to review. The payload stays in Postgres; Redis gets only the id.
 */
export const catalogImportJob = defineJob({
  kind: "catalog.import_analyze",
  queue: "ai",
  payload: z.object({ importId: z.uuid(), phase: z.enum(["scan", "extract"]) }),
});
export type ImportPhase = "scan" | "extract";
