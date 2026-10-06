"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { countUsers, createPasswordUser, withSetupLock } from "@/lib/users";

const setupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name"),
  email: z.email("Invalid email"),
  password: z.string().min(12, "The password must be at least 12 characters long"),
});

export type SetupState = { error?: string };

export async function createFirstAdmin(_prev: SetupState, form: FormData): Promise<SetupState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const created = await withSetupLock(async () => {
    if ((await countUsers()) > 0) return false;
    await createPasswordUser({ ...parsed.data, isAdmin: true, isProductOwner: true });
    return true;
  });
  if (!created) redirect("/login");
  await auth.api.signInEmail({
    body: { email: parsed.data.email, password: parsed.data.password },
  });
  redirect("/");
}
