"use server";

import { assertCan } from "@forgecy/core";
import { revalidatePath } from "next/cache";
import { clientSchema, createClientFor } from "@/lib/create-client";
import { firstIssue } from "@/lib/i18n";
import { requireUser } from "@/lib/session";

export type ClientFormState = { error?: string; ok?: boolean };

export async function createClientAction(
  _prev: ClientFormState,
  form: FormData,
): Promise<ClientFormState> {
  const user = await requireUser();
  assertCan(user.actor, "project.edit");
  const parsed = clientSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  await createClientFor(user, parsed.data);
  revalidatePath("/clients");
  return { ok: true };
}
