/**
 * Brand Guard service: runs the checks against the client's published Brand
 * Identity (or the version the content was generated with), stores the report and
 * records what people decide about findings. Agents (the Reviewer) may run checks;
 * only people ignore, reopen or confirm findings, enforced by `can()`.
 */
import { getBrandIdentityVersion, getPublishedBrandIdentity } from "@forgecy/brand/read";
import {
  assertCan,
  type ForgecyError,
  PermissionDeniedError,
  type Actor,
  type BrandCheckIgnoreReason,
} from "@forgecy/core";
import { localizedError, type MessageKey } from "@forgecy/i18n";
import {
  actorKey,
  and,
  brandCheckIssueStates,
  brandCheckRuns,
  desc,
  eq,
  recordAuditEvent,
  type Database,
} from "@forgecy/db";
import { checkContent, type CheckOptions } from "./checks";
import {
  applyIssueStates,
  approvalGate,
  canIgnore,
  type ApprovalGate,
  type IssueState,
  type ReviewedReport,
} from "./review";
import {
  guardContentSchema,
  guardRenderSchema,
  type BrandCheckReport,
  type GuardContent,
  type GuardRender,
} from "./types";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

/** The checked content, e.g. `{ type: "carousel", id, version: 3 }`. */
export interface BrandCheckSubject {
  type: string;
  id: string;
  version?: number | null;
}

export interface BrandCheckResult {
  runId: string;
  createdAt: Date;
  subjectVersion: number | null;
  report: ReviewedReport;
}

type RunRow = typeof brandCheckRuns.$inferSelect;

function fail(
  code: ForgecyError["code"],
  key: Extract<MessageKey, `review.errors.${string}`>,
  details: Record<string, unknown>,
): never {
  throw localizedError(code, key, undefined, details);
}

function requirePerson(actor: Actor): asserts actor is Extract<Actor, { type: "user" }> {
  // Ignoring and confirming are decisions: never an agent's, whatever the permission.
  if (actor.type !== "user") throw new PermissionDeniedError("edit_draft", actor);
}

async function latestRuns(db: Executor, clientId: string, subject: BrandCheckSubject, limit = 1) {
  return db
    .select()
    .from(brandCheckRuns)
    .where(
      and(
        eq(brandCheckRuns.clientId, clientId),
        eq(brandCheckRuns.subjectType, subject.type),
        eq(brandCheckRuns.subjectId, subject.id),
      ),
    )
    .orderBy(desc(brandCheckRuns.createdAt), desc(brandCheckRuns.id))
    .limit(limit);
}

async function statesOf(db: Executor, clientId: string, subject: BrandCheckSubject) {
  const rows = await db
    .select()
    .from(brandCheckIssueStates)
    .where(
      and(
        eq(brandCheckIssueStates.clientId, clientId),
        eq(brandCheckIssueStates.subjectType, subject.type),
        eq(brandCheckIssueStates.subjectId, subject.id),
      ),
    );
  return rows.map((r): IssueState => ({
    findingKey: r.findingKey,
    blockHash: r.blockHash,
    status: r.status,
    reason: r.reason,
    note: r.note,
    subjectVersion: r.subjectVersion,
    userId: r.userId,
    createdAt: r.createdAt,
  }));
}

const reportOf = (run: RunRow) => run.report as unknown as BrandCheckReport;

function reviewed(
  run: RunRow,
  states: IssueState[],
  previous: RunRow | undefined,
  subjectVersion?: number | null,
): BrandCheckResult {
  return {
    runId: run.id,
    createdAt: run.createdAt,
    subjectVersion: run.subjectVersion,
    report: applyIssueStates(reportOf(run), states, {
      subjectVersion: subjectVersion === undefined ? run.subjectVersion : subjectVersion,
      previous: previous ? reportOf(previous) : null,
    }),
  };
}

/**
 * Runs the Brand Guard on a content. Without `brandVersionId` the published version is
 * used; generation stores the version it used and passes it here for later checks.
 * `render` carries the renderer's measures (and pixel contrast) when the render ran.
 */
export async function runBrandCheck(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    subject: BrandCheckSubject;
    content: GuardContent;
    render?: GuardRender;
    brandVersionId?: string;
    options?: CheckOptions;
  },
): Promise<BrandCheckResult> {
  assertCan(actor, "propose", input.clientId);
  const content = guardContentSchema.parse(input.content);
  const render = input.render ? guardRenderSchema.parse(input.render) : undefined;
  const brand = input.brandVersionId
    ? await getBrandIdentityVersion(db, actor, {
        clientId: input.clientId,
        versionId: input.brandVersionId,
      })
    : await getPublishedBrandIdentity(db, actor, input.clientId);
  if (!brand)
    fail(
      "conflict",
      input.brandVersionId
        ? "review.errors.brandVersionNotApproved"
        : "review.errors.brandNotPublished",
      { code: "BRAND-NOT-PUBLISHED" },
    );
  const report = checkContent(content, brand, render, input.options);
  const subjectVersion = input.subject.version ?? null;

  return db.transaction(async (tx) => {
    const [previous] = await latestRuns(tx, input.clientId, input.subject);
    const [run] = await tx
      .insert(brandCheckRuns)
      .values({
        clientId: input.clientId,
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        subjectVersion,
        brandIdentityVersionId: brand.versionId,
        hasRender: report.hasRender,
        report: report as unknown as Record<string, unknown>,
        errors: report.counts.error,
        warnings: report.counts.warning,
        notes: report.counts.note,
        score: report.coherence.score,
        runBy: actorKey(actor),
      })
      .returning();
    await recordAuditEvent(tx, {
      actor,
      action: "brand_check_completed",
      entity: input.subject.type,
      entityId: input.subject.id,
      clientId: input.clientId,
      meta: {
        runId: run!.id,
        subjectVersion,
        errors: report.counts.error,
        warnings: report.counts.warning,
        notes: report.counts.note,
        score: report.coherence.score,
        biVersion: brand.number,
        hasRender: report.hasRender,
      },
    });
    return reviewed(run!, await statesOf(tx, input.clientId, input.subject), previous);
  });
}

/** The latest check of a content with people's decisions applied, or null if never checked. */
export async function getBrandCheck(
  db: Database,
  actor: Actor,
  input: { clientId: string; subject: BrandCheckSubject },
): Promise<BrandCheckResult | null> {
  assertCan(actor, "view", input.clientId);
  const [run, previous] = await latestRuns(db, input.clientId, input.subject, 2);
  if (!run) return null;
  return reviewed(
    run,
    await statesOf(db, input.clientId, input.subject),
    previous,
    input.subject.version,
  );
}

async function findingOf(db: Executor, clientId: string, subject: BrandCheckSubject, key: string) {
  const [run] = await latestRuns(db, clientId, subject);
  const finding = run ? reportOf(run).findings.find((f) => f.key === key) : undefined;
  if (!finding)
    fail("not_found", "review.errors.findingNotFound", {
      code: "BRAND-CHECK-FINDING-NOT-FOUND",
    });
  return finding;
}

function stateWhere(
  input: { clientId: string; subject: BrandCheckSubject; findingKey: string },
  status: "ignored" | "acknowledged",
) {
  return and(
    eq(brandCheckIssueStates.clientId, input.clientId),
    eq(brandCheckIssueStates.subjectType, input.subject.type),
    eq(brandCheckIssueStates.subjectId, input.subject.id),
    eq(brandCheckIssueStates.findingKey, input.findingKey),
    eq(brandCheckIssueStates.status, status),
  );
}

/** “Ignore for this content”: warnings and notes only, with a reason. */
export async function ignoreFinding(
  db: Database,
  actor: Actor,
  input: {
    clientId: string;
    subject: BrandCheckSubject;
    findingKey: string;
    reason: BrandCheckIgnoreReason;
    note?: string;
  },
): Promise<void> {
  requirePerson(actor);
  assertCan(actor, "edit_draft", input.clientId);
  const note = input.note?.trim() || null;
  if (input.reason === "other" && !note)
    fail("validation", "review.errors.reasonRequired", { code: "BRAND-CHECK-NOTE-REQUIRED" });
  if (note && note.length > 280)
    fail("validation", "review.errors.reasonTooLong", {
      code: "BRAND-CHECK-NOTE-TOO-LONG",
    });
  await db.transaction(async (tx) => {
    const finding = await findingOf(tx, input.clientId, input.subject, input.findingKey);
    if (!canIgnore(finding))
      fail("validation", "review.errors.errorNotIgnorable", {
        code: "BRAND-CHECK-ERROR-NOT-IGNORABLE",
      });
    await tx.delete(brandCheckIssueStates).where(stateWhere(input, "ignored"));
    await tx.insert(brandCheckIssueStates).values({
      clientId: input.clientId,
      subjectType: input.subject.type,
      subjectId: input.subject.id,
      findingKey: finding.key,
      blockHash: finding.blockHash,
      status: "ignored",
      reason: input.reason,
      note,
      subjectVersion: null,
      userId: actor.id,
    });
    await recordAuditEvent(tx, {
      actor,
      action: "brand_check_issue_ignored",
      entity: input.subject.type,
      entityId: input.subject.id,
      clientId: input.clientId,
      meta: { findingKey: finding.key, check: finding.check, reason: input.reason },
    });
  });
}

/** “Reopen” an ignored finding. */
export async function reopenFinding(
  db: Database,
  actor: Actor,
  input: { clientId: string; subject: BrandCheckSubject; findingKey: string },
): Promise<void> {
  requirePerson(actor);
  assertCan(actor, "edit_draft", input.clientId);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(brandCheckIssueStates)
      .where(stateWhere(input, "ignored"))
      .returning({ id: brandCheckIssueStates.id });
    if (!removed.length) return;
    await recordAuditEvent(tx, {
      actor,
      action: "brand_check_issue_reopened",
      entity: input.subject.type,
      entityId: input.subject.id,
      clientId: input.clientId,
      meta: { findingKey: input.findingKey },
    });
  });
}

/**
 * Approval gate for the Contents module, called inside its approve transaction:
 * the latest check must be on the version being approved, no AI image may wait for
 * approval, and every open error and warning needs “I’ve seen it” (stored here, per
 * version). Throws a ForgecyError whose `details.code` the dialog can show.
 */
export async function confirmBrandCheckForApproval(
  db: Executor,
  actor: Actor,
  input: {
    clientId: string;
    subject: BrandCheckSubject & { version: number };
    acknowledgedKeys: readonly string[];
  },
): Promise<ApprovalGate> {
  requirePerson(actor);
  assertCan(actor, "approve", input.clientId);
  const [run, previous] = await latestRuns(db, input.clientId, input.subject, 2);
  if (!run)
    fail("conflict", "review.errors.checksNotRun", {
      code: "BRAND-CHECK-NOT-RUN",
    });
  if (run.subjectVersion !== input.subject.version)
    fail("conflict", "review.errors.checksStale", {
      code: "BRAND-CHECK-STALE",
      checkedVersion: run.subjectVersion,
    });
  const { report } = reviewed(
    run,
    await statesOf(db, input.clientId, input.subject),
    previous,
    input.subject.version,
  );
  const gate = approvalGate(report, input.acknowledgedKeys);
  if (gate.blockers.length)
    fail("conflict", "review.errors.aiImagesPending", {
      code: "AI-IMAGES-NOT-APPROVED",
      findings: gate.blockers.map((f) => f.key),
    });
  if (gate.toAcknowledge.length)
    fail("validation", "review.errors.checksNotAcknowledged", {
      code: "CHECKS-NOT-ACKNOWLEDGED",
      missing: gate.toAcknowledge.map((f) => f.key),
    });
  const toStore = report.findings.filter(
    (f) => f.status === "open" && !f.acknowledged && input.acknowledgedKeys.includes(f.key),
  );
  if (toStore.length) {
    await db
      .insert(brandCheckIssueStates)
      .values(
        toStore.map((f) => ({
          clientId: input.clientId,
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          findingKey: f.key,
          blockHash: f.blockHash,
          status: "acknowledged" as const,
          subjectVersion: input.subject.version,
          userId: actor.id,
        })),
      )
      .onConflictDoNothing();
    await recordAuditEvent(db, {
      actor,
      action: "brand_check_acknowledged",
      entity: input.subject.type,
      entityId: input.subject.id,
      clientId: input.clientId,
      meta: { version: input.subject.version, findingKeys: toStore.map((f) => f.key) },
    });
  }
  return gate;
}
