"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { firstIssue, vmsg } from "@/lib/i18n";
import { loginGuard } from "@/lib/login-guard";
import { refinePassword } from "@/lib/password-schema";
import { setupTokenOk } from "@/lib/setup-token";
import { emailToUsername, isValidUsername, usernameToEmail } from "@/lib/username";
import { countUsers, createPasswordUser, withSetupLock } from "@/lib/users";

const setupSchema = z
  .object({
    username: z
      .string()
      .trim()
      .refine(isValidUsername, vmsg("validation.usernameInvalid"))
      .transform(usernameToEmail),
    password: z.string(),
  })
  .superRefine(refinePassword);

export type SetupState = { error?: string };

export async function createFirstAdmin(_prev: SetupState, form: FormData): Promise<SetupState> {
  const token = env.FORGECY_SETUP_TOKEN;
  if (token) {
    const t = await getTranslations("auth");
    // Shared throttle: the ticket is taken before the comparison and a wrong token keeps it.
    if ((await loginGuard.attempt("setup-token")) > 0) return { error: t("login.tooManyAttempts") };
    if (!setupTokenOk(token, String(form.get("setupToken") ?? ""))) {
      return { error: t("setup.setupTokenInvalid") };
    }
    await loginGuard.succeeded("setup-token");
  }
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
  // The account exists now: any sign-in failure (a pre-locked username answers 429) sends
  // the person to the login page instead of an error page.
  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.username, password: parsed.data.password },
    });
  } catch {
    redirect("/login");
  }
  redirect("/");
}
