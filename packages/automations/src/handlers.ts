/**
 * Worker handler of batch automations: one job per item, run as the person who started
 * the run. The item creates a draft carousel, generates its outline and, when the run
 * goes that far, approves that outline on the starter's behalf and generates the slides.
 * Nothing is ever sent for review, approved as a carousel, or exported.
 */
import { getPublishedBrandIdentity } from "@forgecy/brand";
import {
  approveOutline,
  clampSlideCount,
  createCarousel,
  getContentRow,
  getTemplate,
  listUsableTemplates,
  runGenerateOutline,
  runGenerateSlides,
  type PipelineDeps,
} from "@forgecy/content";
import { pipelineDepsFor } from "@forgecy/content/handlers";
import { ForgecyError, loadEnv, messageRefOf, type Actor } from "@forgecy/core";
import {
  and,
  automationRunItems,
  automationRuns,
  automations,
  eq,
  isNull,
  jobsLog,
  or,
  sql,
  users,
  type Database,
} from "@forgecy/db";
import { englishMessage, messageRef, type MessageKey } from "@forgecy/i18n";
import {
  createQueues,
  handle,
  type JobContext,
  type JobHandlers,
  type JobQueues,
} from "@forgecy/jobs";
import {
  itemTarget,
  readItems,
  readParams,
  type AutomationItem,
  type AutomationParams,
} from "./config";
import { automationItemJob } from "./jobs";
import { failForPolicy, pauseRows, queueNextItem, type AutomationRunItemRow } from "./service";

type ItemErrorKey = Extract<MessageKey, `automations.itemErrors.${string}`>;

/** An item failure with a short code for the table and a translated message. */
class ItemError extends Error {
  readonly ref;
  constructor(
    readonly code: string,
    key: ItemErrorKey,
  ) {
    super(englishMessage(key));
    this.ref = messageRef(key);
  }
}

export interface AutomationHandlerDeps {
  db: Database;
  queues: JobQueues;
  pipeline: PipelineDeps;
}

async function starterActor(db: Database, userId: string | null): Promise<Actor> {
  const [user] = userId
    ? await db
        .select({ id: users.id, isAdmin: users.isAdmin, active: users.active })
        .from(users)
        .where(eq(users.id, userId))
    : [];
  if (!user?.active)
    throw new ItemError("STARTER-INACTIVE", "automations.itemErrors.starterInactive");
  return { type: "user", id: user.id, isAdmin: user.isAdmin, active: true };
}

/** The configured template when it fits the item's format, else the first usable one. */
async function templateFor(
  db: Database,
  clientId: string,
  key: string | null,
  format: AutomationParams["format"],
) {
  if (key) {
    const t = await getTemplate(db, clientId, key).catch(() => null);
    if (t && t.format === format) return t;
  }
  const [first] = await listUsableTemplates(db, clientId, { format });
  if (!first) throw new ItemError("NO-TEMPLATE", "automations.itemErrors.noTemplate");
  return first;
}

async function setItem(db: Database, id: string, values: Partial<AutomationRunItemRow>) {
  await db
    .update(automationRunItems)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(automationRunItems.id, id));
}

async function jobCost(db: Database, jobId: string) {
  const [r] = await db
    .select({ cost: sql<number>`coalesce(sum(${jobsLog.costMicroUsd}), 0)::bigint` })
    .from(jobsLog)
    .where(eq(jobsLog.jobId, jobId));
  return Number(r?.cost ?? 0);
}

/** Runs one item; a failure stays on the item and the run goes on with the next one. */
export async function runAutomationItem(
  deps: AutomationHandlerDeps,
  payload: { runItemId: string },
  ctx: Pick<JobContext, "jobId" | "progress">,
) {
  const { db } = deps;
  const [item] = await db
    .select()
    .from(automationRunItems)
    .where(eq(automationRunItems.id, payload.runItemId));
  if (!item) return { status: "missing" as const };
  const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, item.runId));
  const [automation] = run
    ? await db.select().from(automations).where(eq(automations.id, run.automationId))
    : [];
  if (!run || !automation) return { status: "missing" as const };

  if (item.status === "running") {
    // Another job owns the item (a leftover from a pause/resume): leave the live one alone.
    if (item.jobId && item.jobId !== ctx.jobId) return { status: "duplicate" as const };
    // A previous attempt died halfway (worker restart): never create a second carousel.
    await setItem(db, item.id, {
      status: "failed",
      errorCode: "INTERRUPTED",
      error: englishMessage("automations.itemErrors.interrupted"),
      errorRef: messageRef("automations.itemErrors.interrupted"),
      endedAt: new Date(),
    });
    await queueNextItem(deps, run.id);
    return { status: "failed" as const };
  }
  if (item.status !== "queued") {
    await queueNextItem(deps, run.id);
    return { status: item.status };
  }
  if (automation.status !== "active" || run.status !== "running") {
    // Paused before the worker took it: resuming queues it again.
    await setItem(db, item.id, { jobId: null });
    return { status: "waiting" as const };
  }

  // Compare-and-set: only a still-queued item that is unclaimed or already ours may start.
  const [claimed] = await db
    .update(automationRunItems)
    .set({ status: "running", startedAt: new Date(), jobId: ctx.jobId, updatedAt: new Date() })
    .where(
      and(
        eq(automationRunItems.id, item.id),
        eq(automationRunItems.status, "queued"),
        or(isNull(automationRunItems.jobId), eq(automationRunItems.jobId, ctx.jobId)),
      ),
    )
    .returning({ id: automationRunItems.id });
  if (!claimed) return { status: "duplicate" as const };
  const input: AutomationItem | undefined = readItems([item.input])[0];
  const params = readParams((item.input as { params?: unknown }).params);
  let contentId = item.contentId;
  let outcome: "completed" | "failed" = "completed";
  let stop: "budget" | "policy" | null = null;
  try {
    if (!input) throw new ItemError("INVALID-ITEM", "automations.itemErrors.invalidItem");
    const actor = await starterActor(db, run.startedBy);
    const pctx = {
      jobId: ctx.jobId,
      requestedBy: run.startedBy,
      progress: (p: number) => ctx.progress(p),
    };
    if (!contentId) {
      const target = itemTarget(input, params);
      const template = await templateFor(db, run.clientId, params.templateKey, target.format);
      const brand = await getPublishedBrandIdentity(db, actor, run.clientId);
      const audienceIds = params.audienceIds.length
        ? params.audienceIds
        : (brand?.document.strategy.audience ?? [])
            .filter((a) => !a.deprecated)
            .map((a) => a.id)
            .slice(0, 20);
      if (!audienceIds.length)
        throw new ItemError("NO-AUDIENCE", "automations.itemErrors.noAudience");
      const created = await createCarousel(db, actor, {
        clientId: run.clientId,
        params: {
          title: input.title,
          objective: input.objective ?? "awareness",
          audienceIds,
          pillarId: input.pillarId,
          rubricId: input.rubricId,
          channel: target.channel,
          format: target.format,
          templateKey: template.key,
          slideCount: clampSlideCount(template.manifest, params.slideCount),
          language: params.language,
          planItemId: input.planItemId,
        },
        brief: { text: input.brief, audienceNote: input.audienceNote, cta: input.cta },
      });
      contentId = created.id;
      await setItem(db, item.id, { contentId, step: "created" });
    }
    await ctx.progress(10);
    await runGenerateOutline(deps.pipeline, pctx, {
      clientId: run.clientId,
      contentId,
      instruction: "",
      keepEdited: true,
    });
    await setItem(db, item.id, { step: "outline" });
    if (run.stopAt === "slides") {
      const c = await getContentRow(db, run.clientId, contentId);
      await approveOutline(db, actor, {
        clientId: run.clientId,
        id: contentId,
        outlineNumber: c.outlineNumber,
      });
      await runGenerateSlides(deps.pipeline, pctx, { clientId: run.clientId, contentId });
      await setItem(db, item.id, { step: "slides" });
    }
  } catch (err) {
    outcome = "failed";
    let code = err instanceof ItemError ? err.code : "ITEM-FAILED";
    if (err instanceof ForgecyError) {
      if (err.code === "budget_exceeded") {
        code = "BUDGET-EXCEEDED";
        stop = "budget";
      } else if (err.code === "policy_blocked") {
        code = "POLICY-BLOCKED";
        stop = "policy";
      } else if (typeof err.details?.code === "string") code = err.details.code;
    }
    await setItem(db, item.id, {
      errorCode: code.slice(0, 40),
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      errorRef: messageRefOf(err),
    });
  }
  await setItem(db, item.id, {
    status: outcome,
    costMicroUsd: await jobCost(db, ctx.jobId),
    endedAt: new Date(),
  });
  if (stop === "budget")
    await pauseRows(db, automation.id, { key: "automations.status.budgetPaused" });
  else if (stop === "policy") await failForPolicy(db, automation.id, run.id);
  else await queueNextItem(deps, run.id);
  return { status: outcome, contentId };
}

let shared: Promise<JobQueues> | undefined;

/** `...automationHandlers()` in apps/worker. */
export function automationHandlers(): JobHandlers {
  return handle(automationItemJob, async (payload, ctx) => {
    shared ??= createQueues(loadEnv().REDIS_URL);
    return runAutomationItem(
      { db: ctx.db, queues: await shared, pipeline: await pipelineDepsFor(ctx.db, ctx.logger) },
      payload,
      ctx,
    );
  });
}
