"use server";

import { setCommercialUse } from "@forgecy/content";
import { assertCan, ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { eq, getDb, users } from "@forgecy/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { createPasswordUser } from "@/lib/users";

const newUserSchema = z.object({
  name: z.string().trim().min(1, "Enter the name"),
  email: z.email("Invalid email"),
  password: z.string().min(12, "The password must be at least 12 characters long"),
  isAdmin: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});

export type NewUserState = { error?: string; ok?: boolean };

export async function createUserAction(_prev: NewUserState, form: FormData): Promise<NewUserState> {
  const admin = await requireUser();
  assertCan(admin.actor, "users.manage");
  const parsed = newUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const exists = await getDb().query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
    columns: { id: true },
  });
  if (exists) return { error: "A user with this email already exists." };
  await createPasswordUser({ ...parsed.data, createdBy: admin.id });
  revalidatePath("/settings");
  return { ok: true };
}

export type CommercialUseState = { error?: string; ok?: boolean };

export async function setCommercialUseAction(
  _prev: CommercialUseState,
  form: FormData,
): Promise<CommercialUseState> {
  const admin = await requireUser();
  try {
    await setCommercialUse(getDb(), admin.actor, Object.fromEntries(form));
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { error: "This setting is reserved for Admin users." };
    if (err instanceof ForgecyError) return { error: err.message };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  return { ok: true };
}
