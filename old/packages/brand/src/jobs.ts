import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/** Reads one imported source and turns what it finds into proposals (Brand Analyst). */
export const brandImportSourceJob = defineJob({
  kind: "brand.import_source",
  queue: "ai",
  payload: z.object({
    clientId: z.uuid(),
    sourceId: z.uuid(),
    /** Person who started the import: recorded as authorized_by in jobs_log. */
    requestedBy: z.uuid().nullish(),
    /** Interface language of that person: the Brand Analyst explains its proposals in it. */
    language: z.string().min(2).max(8).default("en"),
  }),
});

/**
 * Reads the client's website (home page and the most relevant pages found from
 * there), stores it as a `website` source, then runs the same Brand Analyst step
 * as `brand.import_source`. Enqueued automatically whenever a prospect or client
 * gets a website address.
 */
export const brandCrawlWebsiteJob = defineJob({
  kind: "brand.crawl_website",
  queue: "media",
  payload: z.object({
    clientId: z.uuid(),
    sourceId: z.uuid(),
    requestedBy: z.uuid().nullish(),
    language: z.string().min(2).max(8).default("en"),
  }),
});
