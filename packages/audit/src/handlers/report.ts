import { FIXED_REPORT_SECTIONS, type ReportSection, type ReportSectionKey } from "@forgecy/core";
import { and, auditPlans, auditReports, eq, prospectProfiles, sql } from "@forgecy/db";
import { UnrecoverableError, type JobContext } from "@forgecy/jobs";
import {
  COPYWRITER_EMAIL,
  dataBlock,
  reportEmailSchema,
  reportTextsSchema,
  STRATEGIST_REPORT,
} from "../ai/agents";
import { loadAudit } from "../service/common";
import { reportFindings, REPORT_LIMITS } from "../service/reports";
import { prospectContext } from "./analysis";
import { oneLine, runAgent, unrecoverable, type AuditHandlerDeps } from "./context";

/** Sections whose texts an agent writes; cover and method are filled by the system. */
const WRITABLE = (k: ReportSectionKey) => !FIXED_REPORT_SECTIONS.includes(k);

/** Sections the run rewrites: the ones asked for, else every one not edited by hand. */
export function sectionsToWrite(
  sections: ReportSection[],
  asked: ReportSectionKey[] | undefined,
): ReportSectionKey[] {
  return sections
    .filter((s) => s.enabled && WRITABLE(s.key))
    .filter((s) => (asked ? asked.includes(s.key) : s.byAgent !== false))
    .map((s) => s.key);
}

/**
 * “audit.report_texts”: the Strategist proposes intros and key bullets, the
 * Copywriter the email. Texts land in the draft marked as the agent's; a section
 * a person edited meanwhile is left as it is.
 */
export async function runReportTexts(
  deps: AuditHandlerDeps,
  payload: {
    reportId: string;
    sections?: ReportSectionKey[] | undefined;
    email: boolean;
    instruction?: string | undefined;
  },
  ctx: JobContext,
) {
  const { db } = deps;
  const report = await db.query.auditReports.findFirst({
    where: eq(auditReports.id, payload.reportId),
  });
  if (!report) throw new UnrecoverableError("Report not found");
  if (report.status !== "draft") throw unrecoverable("audit.jobErrors.notDraft");
  const { audit, client } = await loadAudit(db, report.auditId);
  const [profile, plan, grouped] = await Promise.all([
    db.query.prospectProfiles.findFirst({ where: eq(prospectProfiles.clientId, client.id) }),
    db.query.auditPlans.findFirst({ where: eq(auditPlans.auditId, audit.id) }),
    reportFindings(db, report),
  ]);
  const instruction = payload.instruction
    ? dataBlock("agency instruction", oneLine(payload.instruction, 500))
    : "";

  const findingLines = (key: ReportSectionKey) =>
    grouped[key]
      .filter((f) => !f.excluded)
      .map(
        ({ finding: f }, i) =>
          `- F${i + 1} [${f.priority}] ${f.title}: ${oneLine(
            f.kind === "comparison" ? f.comparison?.rationale : f.description,
            240,
          )}${f.recommendation ? ` Recommendation: ${oneLine(f.recommendation, 200)}` : ""}`,
      );
  const problems = findingLines("problems");
  const planLines =
    plan && (plan.status === "accepted" || plan.status === "edited")
      ? plan.pillars.map((p) => `- ${p.name}: ${oneLine(p.goal, 200)}`)
      : [];

  const keys = sectionsToWrite(report.sections, payload.sections);
  let costMicroUsd = 0;
  const texts = new Map<ReportSectionKey, { intro: string; bullets: string[] }>();
  if (keys.length) {
    await ctx.progress(10);
    const blocks = keys.map((key) => {
      const lines = key === "overview" || key === "next_steps" ? problems : findingLines(key);
      const extra = key === "next_steps" && planLines.length ? ["Plan pillars:", ...planLines] : [];
      return `## ${key}\n${[...lines, ...extra].join("\n") || "(no items)"}`;
    });
    const run = await runAgent(deps, ctx, {
      client,
      role: "strategist",
      task: "audit_report",
      schema: reportTextsSchema,
      schemaName: "report_texts",
      system: STRATEGIST_REPORT,
      language: profile?.reportLanguage,
      prompt: [
        prospectContext(audit, client),
        `Sections to write: ${keys.join(", ")}.`,
        dataBlock("audit results", blocks.join("\n\n")),
        instruction,
      ]
        .filter(Boolean)
        .join("\n\n"),
      action: "audit.ai.report_texts",
      entityId: audit.id,
    });
    costMicroUsd += run.costMicroUsd;
    for (const s of run.data.sections) {
      if (!keys.includes(s.key)) continue;
      const bullets =
        s.key === "overview" || s.key === "next_steps"
          ? s.bullets.slice(0, REPORT_LIMITS.bullets)
          : [];
      texts.set(s.key, { intro: s.intro.slice(0, REPORT_LIMITS.intro), bullets });
    }
  }

  let email: { subject: string; body: string } | null = null;
  if (payload.email) {
    await ctx.progress(60);
    const overview = texts.get("overview")?.bullets ?? [];
    const run = await runAgent(deps, ctx, {
      client,
      role: "copywriter",
      task: "audit_report",
      schema: reportEmailSchema,
      schemaName: "report_email",
      system: COPYWRITER_EMAIL,
      language: profile?.reportLanguage,
      prompt: [
        prospectContext(audit, client),
        dataBlock(
          "main problems",
          [...problems, ...(overview.length ? ["Key messages:", ...overview] : [])].join("\n") ||
            "(no problems)",
        ),
        instruction,
      ]
        .filter(Boolean)
        .join("\n\n"),
      action: "audit.ai.report_email",
      entityId: audit.id,
    });
    costMicroUsd += run.costMicroUsd;
    email = { subject: run.data.subject, body: run.data.body.slice(0, REPORT_LIMITS.emailBody) };
  }

  // Merge into the current draft: a person may have edited it while the agents worked.
  const before = new Map(report.sections.map((s) => [s.key, s]));
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await db.query.auditReports.findFirst({
      where: eq(auditReports.id, report.id),
    });
    if (!current || current.status !== "draft") throw unrecoverable("audit.jobErrors.notDraft");
    const sections = current.sections.map((s) => {
      const t = texts.get(s.key);
      const start = before.get(s.key);
      const untouched =
        start &&
        start.intro === s.intro &&
        JSON.stringify(start.bullets) === JSON.stringify(s.bullets);
      if (!t || !untouched) return s;
      return {
        ...s,
        intro: t.intro,
        bullets: t.bullets.length ? t.bullets : s.bullets,
        byAgent: true,
      };
    });
    const keepEmail =
      current.emailSubject !== report.emailSubject || current.emailBody !== report.emailBody;
    const [row] = await db
      .update(auditReports)
      .set({
        sections,
        ...(email && !keepEmail
          ? { emailSubject: email.subject, emailBody: email.body, emailByAgent: true }
          : {}),
        rev: sql`${auditReports.rev} + 1`,
      })
      .where(and(eq(auditReports.id, current.id), eq(auditReports.rev, current.rev)))
      .returning({ id: auditReports.id });
    if (row) return { sections: texts.size, email: Boolean(email && !keepEmail), costMicroUsd };
  }
  throw unrecoverable("audit.jobErrors.reportBusy");
}
