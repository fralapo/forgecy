import type { AiGateway } from "@forgecy/ai";
import { assertCan, ForgecyError, type AgentRole, type AiPolicy } from "@forgecy/core";
import { recordAuditEvent, type AiMeta, type Database } from "@forgecy/db";
import type { StorageDriver } from "@forgecy/files";
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

export type AiTaskName = "audit_analyze" | "audit_diagnose" | "audit_plan";

export interface AgentRun<T> {
  data: T;
  meta: AiMeta;
  costMicroUsd: number;
}

/**
 * One agent call through the gateway. The agent actor can only propose: the
 * permission check runs here, server side, before anything is written.
 * Policy and budget stops end the job in "Richiede attenzione" without retries.
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
  },
): Promise<AgentRun<T>> {
  const policy: AiPolicy = input.client.aiPolicy;
  if (!aiAllowed(policy))
    throw new NeedsAttentionError(
      "La policy di questo prospect non permette l'uso dell'AI: compila la sezione a mano.",
    );
  const actor = { type: "agent" as const, role: input.role, runId: ctx.jobId };
  assertCan(actor, "propose", input.client.id);
  try {
    const res = await deps.gateway.generateObject({
      task: input.task,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      input: input.prompt,
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
      if (
        err.code === "policy_blocked" ||
        err.code === "budget_exceeded" ||
        err.code === "unavailable"
      )
        throw new NeedsAttentionError(err.message, { code: err.code });
      if (err.code === "provider_error")
        throw new UnrecoverableError(
          "Il provider AI non ha risposto in modo valido. Riprova questo passo.",
        );
    }
    throw err;
  }
}

/** Compact one-line text for prompts. */
export function oneLine(s: string | null | undefined, max = 300): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
