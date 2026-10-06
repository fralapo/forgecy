import { reportSectionKeys, socialChannels } from "@forgecy/core";
import { defineJob } from "@forgecy/jobs";
import { z } from "zod";

/**
 * Audit pipeline (spec: audit_crawl, audit_social_ingest, audit_competitors,
 * audit_analyze, audit_diagnose, audit_plan). Each step is its own job, so a
 * failed step is retried alone ("Riprova questo passo") without redoing the others.
 */

/** Read up to 10 pages of the prospect site (or 3 of a competitor) with Playwright. */
export const auditCrawlJob = defineJob({
  kind: "audit.crawl",
  queue: "media",
  payload: z.object({ scanId: z.uuid() }),
});

/** Brand Analyst: observations per website area from the pages read. */
export const auditAnalyzeSiteJob = defineJob({
  kind: "audit.analyze_site",
  queue: "ai",
  payload: z.object({ auditId: z.uuid(), scanId: z.uuid() }),
});

/** Brand Analyst: observations for a social channel from confirmed metrics and imported posts. */
export const auditAnalyzeSocialJob = defineJob({
  kind: "audit.analyze_social",
  queue: "ai",
  payload: z.object({ auditId: z.uuid(), channel: z.enum(socialChannels) }),
});

/** Strategist: 3–5 competitors to confirm. */
export const auditProposeCompetitorsJob = defineJob({
  kind: "audit.propose_competitors",
  queue: "ai",
  payload: z.object({ auditId: z.uuid(), instruction: z.string().max(500).optional() }),
});

/** Brand Analyst: benchmark observations once competitor sites are read. */
export const auditCompareCompetitorsJob = defineJob({
  kind: "audit.compare_competitors",
  queue: "ai",
  payload: z.object({ auditId: z.uuid() }),
});

/** Brand Analyst: website vs Instagram vs Facebook on five criteria. */
export const auditCompareChannelsJob = defineJob({
  kind: "audit.compare_channels",
  queue: "ai",
  payload: z.object({ auditId: z.uuid(), instruction: z.string().max(500).optional() }),
});

/** Strategist: 3–5 problems from accepted observations. */
export const auditDiagnoseJob = defineJob({
  kind: "audit.diagnose",
  queue: "ai",
  payload: z.object({ auditId: z.uuid() }),
});

/** Strategist: content pillars and a 30-day plan from the diagnosis. */
export const auditPlanJob = defineJob({
  kind: "audit.plan",
  queue: "ai",
  payload: z.object({ auditId: z.uuid() }),
});

/**
 * Strategist and Copywriter: section texts and the email text of a report draft.
 * `sections` limits the run to some sections ("Ricomponi sezione"); `email` only the email.
 */
export const auditReportTextsJob = defineJob({
  kind: "audit.report_texts",
  queue: "ai",
  payload: z.object({
    reportId: z.uuid(),
    sections: z.array(z.enum(reportSectionKeys)).optional(),
    email: z.boolean().default(true),
    instruction: z.string().max(500).optional(),
  }),
});

export const auditJobs = [
  auditCrawlJob,
  auditAnalyzeSiteJob,
  auditAnalyzeSocialJob,
  auditProposeCompetitorsJob,
  auditCompareCompetitorsJob,
  auditCompareChannelsJob,
  auditDiagnoseJob,
  auditPlanJob,
  auditReportTextsJob,
] as const;

/** Job kinds whose rows point at the audit (jobs.entity = "audit", jobs.entity_id = audit id). */
export const AUDIT_JOB_ENTITY = "audit";
