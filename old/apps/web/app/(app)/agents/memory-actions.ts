"use server";

import {
  addMemory,
  approveMemories,
  approveMemory,
  archiveMemory,
  editMemory,
  promoteMemory,
  rejectMemory,
  saveClientMemorySetting,
} from "@forgecy/ai";
import { languageSchema, releasedFormats } from "@forgecy/content";
import {
  agentKeySchema,
  memoryCategories,
  memorySettingKeys,
  type Actor,
  type MemorySettingKey,
} from "@forgecy/core";
import { getDb } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { errorMessage } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { AdminActionResult } from "../settings/_lib/admin-action";

/**
 * Memory decisions (spec page 56): any signed-in person (`memory.approve`, checked again
 * in @forgecy/ai); agents never reach these actions.
 */
async function run(work: (actor: Actor) => Promise<string>): Promise<AdminActionResult> {
  const user = await requireUser();
  try {
    const message = await work(user.actor);
    revalidatePath("/agents", "layout");
    return { ok: true, message };
  } catch (err) {
    const error = await errorMessage(err);
    if (error === null) throw err;
    return { ok: false, error };
  }
}

const tm = () => getTranslations("agents.memory");
const fail = (error: string): AdminActionResult => ({ ok: false, error });

const addSchema = z.object({
  clientId: z.uuid(),
  agent: agentKeySchema,
  category: z.enum(memoryCategories),
  content: z.string(),
});

export async function addMemoryAction(input: {
  clientId: string;
  agent: string;
  category: string;
  content: string;
}): Promise<AdminActionResult> {
  const t = await tm();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(t("errors.chooseClient"));
  return run(async (actor) => {
    await addMemory(getDb(), actor, parsed.data);
    return t("addForm.added");
  });
}

const idSchema = z.uuid();

async function withId(
  id: string,
  work: (actor: Actor, id: string) => Promise<string>,
): Promise<AdminActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return fail((await tm())("errors.notFound"));
  return run((actor) => work(actor, parsed.data));
}

export async function approveMemoryAction(id: string, note: string): Promise<AdminActionResult> {
  return withId(id, async (actor, memoryId) => {
    await approveMemory(getDb(), actor, memoryId, note);
    return (await tm())("actions.approved");
  });
}

export async function approveMemoriesAction(ids: string[]): Promise<AdminActionResult> {
  const parsed = z.array(idSchema).max(200).safeParse(ids);
  if (!parsed.success) return fail((await tm())("errors.notFound"));
  return run(async (actor) => {
    const count = await approveMemories(getDb(), actor, parsed.data);
    return (await tm())("bulk.done", { count });
  });
}

export async function rejectMemoryAction(id: string, reason: string): Promise<AdminActionResult> {
  return withId(id, async (actor, memoryId) => {
    await rejectMemory(getDb(), actor, memoryId, reason);
    return (await tm())("actions.rejected");
  });
}

export async function editMemoryAction(
  id: string,
  content: string,
  category: string,
): Promise<AdminActionResult> {
  const cat = z.enum(memoryCategories).safeParse(category);
  if (!cat.success) return fail((await tm())("errors.content"));
  return withId(id, async (actor, memoryId) => {
    const row = await editMemory(getDb(), actor, memoryId, { content, category: cat.data });
    return (await tm())("actions.edited", { version: row.version });
  });
}

export async function promoteMemoryAction(id: string): Promise<AdminActionResult> {
  return withId(id, async (actor, memoryId) => {
    await promoteMemory(getDb(), actor, memoryId);
    return (await tm())("actions.promoted");
  });
}

export async function archiveMemoryAction(id: string): Promise<AdminActionResult> {
  return withId(id, async (actor, memoryId) => {
    await archiveMemory(getDb(), actor, memoryId);
    return (await tm())("actions.archived");
  });
}

/** One structured value; `null` clears it. Format and language must be in the lists. */
export async function saveMemorySettingAction(
  clientId: string,
  key: string,
  value: unknown,
): Promise<AdminActionResult> {
  const t = await tm();
  const client = z.uuid().safeParse(clientId);
  const k = z.enum(memorySettingKeys).safeParse(key);
  if (!client.success || !k.success) return fail(t("errors.chooseClient"));
  const settingKey: MemorySettingKey = k.data;
  if (value !== null) {
    const known =
      settingKey === "format"
        ? (releasedFormats as readonly string[]).includes(String(value))
        : settingKey === "language"
          ? languageSchema.safeParse(value).success
          : true;
    if (!known) return fail(t(`errors.setting.${settingKey}`));
  }
  return run(async (actor) => {
    await saveClientMemorySetting(getDb(), actor, client.data, settingKey, value);
    return t(value === null ? "settings.cleared" : "settings.saved");
  });
}
