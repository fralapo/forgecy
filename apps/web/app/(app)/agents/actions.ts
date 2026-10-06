"use server";

import {
  aiTasks,
  discardAgentInstructionsDraft,
  previewAgentInstructions,
  publishAgentInstructions,
  saveAgentInstructionsDraft,
  saveAgentRoutes,
  setAgentActive,
} from "@forgecy/ai";
import { agentKeySchema, type Actor, type AgentRole } from "@forgecy/core";
import { getDb } from "@forgecy/db";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { webGateway } from "@/lib/ai";
import { errorMessage, getFormat } from "@/lib/i18n";
import { requireAdminAction, type AdminActionResult } from "../settings/_lib/admin-action";

/** Every agent action: Admin only (`agents.configure`), errors as localized text. */
async function run(
  key: string,
  work: (agent: AgentRole, actor: Actor) => Promise<string>,
): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("agents.configure");
  if (denied) return denied;
  const agent = agentKeySchema.safeParse(key);
  if (!agent.success)
    return { ok: false, error: (await getTranslations("agents"))("errors.invalidRoutes") };
  try {
    const message = await work(agent.data, user.actor);
    revalidatePath("/agents");
    revalidatePath(`/agents/${agent.data}` as Route);
    return { ok: true, message };
  } catch (err) {
    const error = await errorMessage(err);
    if (error === null) throw err;
    return { ok: false, error };
  }
}

export async function setAgentActiveAction(
  key: string,
  active: boolean,
  confirmKey?: string,
): Promise<AdminActionResult> {
  return run(key, async (agent, actor) => {
    await setAgentActive(getDb(), actor, agent, active, confirmKey);
    const t = await getTranslations("agents");
    return t(active ? "activation.activated" : "activation.deactivated", {
      name: t(`name.${agent}`),
    });
  });
}

export async function saveAgentRoutesAction(
  key: string,
  form: FormData,
): Promise<AdminActionResult> {
  const routes: Record<string, { provider: string; model: string }> = {};
  for (const task of aiTasks) {
    const provider = form.get(`${task}.provider`);
    if (typeof provider !== "string") continue;
    routes[task] = { provider, model: String(form.get(`${task}.model`) ?? "").trim() };
  }
  return run(key, async (agent, actor) => {
    await saveAgentRoutes(getDb(), actor, agent, routes);
    return (await getTranslations("agents"))("tasks.saved");
  });
}

export async function saveAgentDraftAction(key: string, text: string): Promise<AdminActionResult> {
  return run(key, async (agent, actor) => {
    await saveAgentInstructionsDraft(getDb(), actor, agent, text);
    return (await getTranslations("agents"))("instructions.draftSaved");
  });
}

export async function publishAgentDraftAction(
  key: string,
  text: string,
  changelog: string,
): Promise<AdminActionResult> {
  return run(key, async (agent, actor) => {
    // What is on screen is what gets published, saved or not.
    await saveAgentInstructionsDraft(getDb(), actor, agent, text);
    const row = await publishAgentInstructions(getDb(), actor, agent, changelog);
    return (await getTranslations("agents"))("instructions.published_ok", {
      version: row.version,
    });
  });
}

export async function discardAgentDraftAction(key: string): Promise<AdminActionResult> {
  return run(key, async (agent, actor) => {
    await discardAgentInstructionsDraft(getDb(), actor, agent);
    return (await getTranslations("agents"))("instructions.discarded");
  });
}

export type PreviewActionResult =
  { ok: true; output: string; followed: string[]; meta: string } | { ok: false; error: string };

/** “Try on an example”: the draft on an example the Admin wrote, never client data. */
export async function previewAgentAction(
  key: string,
  input: { task: string; example: string; text: string; version: number },
): Promise<PreviewActionResult> {
  const { user, denied } = await requireAdminAction("agents.configure");
  if (denied) return denied;
  const agent = agentKeySchema.safeParse(key);
  if (!agent.success)
    return { ok: false, error: (await getTranslations("agents"))("preview.errors.task") };
  try {
    const res = await previewAgentInstructions(
      { db: getDb(), gateway: webGateway() },
      user.actor,
      agent.data,
      input,
    );
    const format = await getFormat();
    const t = await getTranslations("agents");
    return {
      ok: true,
      output: res.output,
      followed: res.followed,
      meta: t("preview.meta", {
        model: `${res.provider} · ${res.model}`,
        cost: format.number(res.costMicroUsd / 1_000_000, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 4,
        }),
      }),
    };
  } catch (err) {
    const error = await errorMessage(err);
    if (error === null) throw err;
    return { ok: false, error };
  }
}
