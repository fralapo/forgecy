import type { AiGateway, InputImage } from "@forgecy/ai";
import { assertCan, ForgecyError, type AgentRole, type AiPolicy } from "@forgecy/core";
import { recordAuditEvent, type AiMeta, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
import { englishMessage, messageRef, type MessageKey, type MessageValues } from "@forgecy/i18n";
import {
  NeedsAttentionError,
  UnrecoverableError,
  type JobContext,
  type JobQueues,
} from "@forgecy/jobs";
import type { z } from "zod";
import { PROMPT_VERSION } from "../ai/agents";
import type { PageFetcher } from "../crawl/fetcher";
import { aiAllowed, type ClientRow } from "../service/common";
import type { HostCheck } from "../url";

/** Everything the audit handlers need; built lazily by the worker. */
export interface AuditHandlerDeps {
  db: Database;
  storage: StorageDriver;
  queues: JobQueues;
  gateway: AiGateway;
  /** Browser fetcher (Playwright) with fallback to plain HTML when Chromium is missing. */
  createFetcher: () => Promise<PageFetcher>;
  hostCheck: HostCheck;
  userAgent: string;
  pageTimeoutMs?: number;
  crawlTimeoutMs?: number;
}

export type AiTaskName = "audit_analyze" | "audit_diagnose" | "audit_plan" | "audit_report";

export interface AgentRun<T> {
  data: T;
  meta: AiMeta;
  costMicroUsd: number;
}

/**
 * One agent call through the gateway. The agent actor can only propose: the
 * permission check runs here, server side, before anything is written.
 * Policy and budget stops end the job in "Needs attention" without retries.
 */
export async function runAgent<T>(
  deps: Pick<AuditHandlerDeps, "db" | "gateway">,
  ctx: Pick<JobContext, "jobId" | "row">,
  input: {
    client: Pick<ClientRow, "id" | "aiPolicy">;
    role: AgentRole;
    task: AiTaskName;
    schema: z.ZodType<T>;
    schemaName: string;
    system: string;
    prompt: string;
    action: string;
    entityId: string;
    /** Screenshots for vision models; the gateway logs only their hash and size. */
    images?: InputImage[];
  },
): Promise<AgentRun<T>> {
  const policy: AiPolicy = input.client.aiPolicy;
  if (!aiAllowed(policy)) throw needsAttention("audit.jobErrors.policyNoAi");
  const actor = { type: "agent" as const, role: input.role, runId: ctx.jobId };
  assertCan(actor, "propose", input.client.id);
  try {
    const res = await deps.gateway.generateObject({
      task: input.task,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      input: input.prompt,
      ...(input.images?.length ? { images: input.images } : {}),
      clientId: input.client.id,
      clientPolicy: policy,
      authorizedBy: ctx.row.createdBy,
      jobId: ctx.jobId,
      inputSummary: {
        fields: { prompt: input.prompt },
        meta: { promptVersion: PROMPT_VERSION, action: input.action },
      },
    });
    await recordAuditEvent(deps.db, {
      actor,
      action: input.action,
      entity: "audit",
      entityId: input.entityId,
      clientId: input.client.id,
      meta: {
        provider: res.provider,
        model: res.model,
        promptVersion: PROMPT_VERSION,
        costMicroUsd: res.costMicroUsd,
        fallbackUsed: res.fallbackUsed,
      },
    });
    return {
      data: res.data,
      costMicroUsd: res.costMicroUsd,
      meta: {
        provider: res.provider,
        model: res.model,
        policy,
        jobId: ctx.jobId,
        at: new Date().toISOString(),
      },
    };
  } catch (err) {
    if (err instanceof ForgecyError) {
      // Gateway messages are technical (English): the job row shows a sentence a person can act on.
      if (err.code === "policy_blocked")
        throw needsAttention("audit.jobErrors.policyBlocked", undefined, {
          code: err.code,
          detail: err.message,
        });
      if (err.code === "budget_exceeded")
        throw needsAttention("audit.jobErrors.budgetExceeded", undefined, {
          code: err.code,
          detail: err.message,
        });
      if (err.code === "unavailable")
        throw needsAttention("audit.jobErrors.noProvider", undefined, {
          code: err.code,
          detail: err.message,
        });
      if (err.code === "provider_error") throw unrecoverable("audit.jobErrors.providerInvalid");
    }
    throw err;
  }
}

/** A job error a person must act on, stored with its message reference. */
export function needsAttention(
  key: MessageKey,
  values?: MessageValues,
  details?: Record<string, unknown>,
): NeedsAttentionError {
  return new NeedsAttentionError(englishMessage(key, values), details, messageRef(key, values));
}

/** A failure without retries whose message the interface shows in the user's language. */
export function unrecoverable(key: MessageKey, values?: MessageValues): UnrecoverableError {
  return Object.assign(new UnrecoverableError(englishMessage(key, values)), {
    ref: messageRef(key, values),
  });
}

/** Compact one-line text for prompts. */
export function oneLine(s: string | null | undefined, max = 300): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
