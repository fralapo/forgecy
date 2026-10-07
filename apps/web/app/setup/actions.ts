"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { firstIssue, vmsg } from "@/lib/i18n";
import { PASSWORD_MIN } from "@/lib/password";
import { emailToUsername, usernameToEmail } from "@/lib/username";
import { countUsers, createPasswordUser, withSetupLock } from "@/lib/users";

const setupSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/, vmsg("validation.usernameInvalid"))
    .transform(usernameToEmail),
  password: z
    .string()
    .min(PASSWORD_MIN, vmsg("validation.passwordTooShort", { min: PASSWORD_MIN })),
});

export type SetupState = { error?: string };

export async function createFirstAdmin(_prev: SetupState, form: FormData): Promise<SetupState> {
  const parsed = setupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  const created = await withSetupLock(async () => {
    if ((await countUsers()) > 0) return false;
    const { username: email, password } = parsed.data;
    await createPasswordUser({
      name: emailToUsername(email),
      email,
      password,
      isAdmin: true,
      isProductOwner: true,
    });
    return true;
  });
  if (!created) redirect("/login");
  await auth.api.signInEmail({
    body: { email: parsed.data.username, password: parsed.data.password },
  });
  redirect("/");
}
