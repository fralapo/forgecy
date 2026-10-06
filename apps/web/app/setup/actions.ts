"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { firstIssue, vmsg } from "@/lib/i18n";
import { PASSWORD_MIN } from "@/lib/password";
import { countUsers, createPasswordUser, withSetupLock } from "@/lib/users";

const setupSchema = z.object({
  name: z.string().trim().min(1, vmsg("yourNameRequired")),
  email: z.email(vmsg("emailInvalid")),
  password: z.string().min(PASSWORD_MIN, vmsg("passwordTooShort", { min: PASSWORD_MIN })),
});

export type SetupState = { error?: string };

export async function createFirstAdmin(_prev: SetupState, form: FormData): Promise<SetupState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
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
