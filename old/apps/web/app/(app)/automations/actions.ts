"use server";

import {
  cancelRun,
  createAutomation,
  deleteAutomation,
  duplicateAutomation,
  pauseAutomation,
  resumeAutomation,
  retryFailedItems,
  startAutomation,
  updateAutomation,
  type RunDeps,
} from "@forgecy/automations";
import {
  automationSources,
  automationStopPoints,
  ForgecyError,
  PermissionDeniedError,
} from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentRouting } from "@/lib/ai";
import { errorMessage, firstIssue } from "@/lib/i18n";
import { getQueues } from "@/lib/queues";
import { requireUser } from "@/lib/session";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string; code?: string; details?: Record<string, unknown> };

const uuid = z.uuid();

async function run<T extends object>(
  fn: (actor: Awaited<ReturnType<typeof requireUser>>["actor"]) => Promise<T>,
): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    const out = await fn(user.actor);
    revalidatePath("/automations", "layout");
    return { ok: true, ...out };
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { ok: false, error: (await errorMessage(err)) ?? err.message, code: "PERM-DENIED" };
    if (err instanceof ForgecyError) {
      const code = typeof err.details?.code === "string" ? err.details.code : err.code;
      return {
        ok: false,
        error: (await errorMessage(err)) ?? err.message,
        code,
        ...(err.details ? { details: err.details } : {}),
      };
    }
    if (err instanceof z.ZodError)
      return { ok: false, error: await firstIssue(err), code: "INPUT-INVALID" };
    throw err;
  }
}

async function runDeps(): Promise<RunDeps> {
  const { routing } = await currentRouting();
  return { db: getDb(), queues: await getQueues(), localModel: Boolean(routing.local) };
}

export async function createAutomationAction(input: {
  clientId: string;
  name: string;
  source: string;
}) {
  return run(async (actor) => {
    const row = await createAutomation(getDb(), actor, {
      clientId: uuid.parse(input.clientId),
      name: z.string().trim().min(1).max(120).parse(input.name),
      source: z.enum(automationSources).parse(input.source),
    });
    return { id: row.id };
  });
}

export async function saveAutomationAction(input: {
  id: string;
  rev: number;
  name: string;
  stopAt: string;
  params: unknown;
  items: unknown;
}) {
  return run(async (actor) => {
    const row = await updateAutomation(getDb(), actor, {
      id: uuid.parse(input.id),
      rev: z.number().int().min(0).parse(input.rev),
      name: input.name,
      stopAt: z.enum(automationStopPoints).parse(input.stopAt),
      params: input.params,
      items: input.items,
    });
    return { rev: row.draftRev };
  });
}

export async function startAutomationAction(input: { id: string; confirmCost: boolean }) {
  return run(async (actor) => {
    const r = await startAutomation(await runDeps(), actor, {
      id: uuid.parse(input.id),
      confirmCost: input.confirmCost === true,
    });
    return { runId: r.id };
  });
}

export async function retryFailedAction(input: { id: string; confirmCost: boolean }) {
  return run(async (actor) => {
    const r = await retryFailedItems(await runDeps(), actor, {
      id: uuid.parse(input.id),
      confirmCost: input.confirmCost === true,
    });
    return { runId: r.id };
  });
}

export async function pauseAutomationAction(input: { id: string }) {
  return run(async (actor) => {
    await pauseAutomation(getDb(), actor, { id: uuid.parse(input.id) });
    return {};
  });
}

export async function resumeAutomationAction(input: { id: string; confirmCost: boolean }) {
  return run(async (actor) => {
    await resumeAutomation(await runDeps(), actor, {
      id: uuid.parse(input.id),
      confirmCost: input.confirmCost === true,
    });
    return {};
  });
}

export async function cancelRunAction(input: { id: string }) {
  return run(async (actor) => {
    await cancelRun(getDb(), actor, { id: uuid.parse(input.id) });
    return {};
  });
}

export async function duplicateAutomationAction(input: { id: string; name: string }) {
  return run(async (actor) => {
    const row = await duplicateAutomation(getDb(), actor, {
      id: uuid.parse(input.id),
      name: z.string().max(200).parse(input.name),
    });
    return { id: row.id };
  });
}

export async function deleteAutomationAction(input: { id: string }) {
  return run(async (actor) => {
    await deleteAutomation(getDb(), actor, uuid.parse(input.id));
    return {};
  });
}
