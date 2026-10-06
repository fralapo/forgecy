"use server";

import {
  beginMcpConnection,
  disconnectMcp,
  imageProviderIds,
  mcpImageProviderIds,
  saveAiRoutingSettings,
} from "@forgecy/ai";
import { setCommercialUse } from "@forgecy/content";
import { assertCan, ForgecyError, localeSchema, PermissionDeniedError } from "@forgecy/core";
import { eq, getDb, users } from "@forgecy/db";
import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { errorMessage, firstIssue, vmsg } from "@/lib/i18n";
import { PASSWORD_MIN } from "@/lib/password";
import { requireUser } from "@/lib/session";
import { isTheme, THEME_COOKIE } from "@/lib/theme";
import { createPasswordUser } from "@/lib/users";

const newUserSchema = z.object({
  name: z.string().trim().min(1, vmsg("validation.nameRequired")),
  email: z.email(vmsg("validation.emailInvalid")),
  password: z
    .string()
    .min(PASSWORD_MIN, vmsg("validation.passwordTooShort", { min: PASSWORD_MIN })),
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
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  const exists = await getDb().query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
    columns: { id: true },
  });
  if (exists) return { error: (await getTranslations("errors"))("userExists") };
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
      return { error: (await getTranslations("errors"))("adminOnly") };
    const error = await errorMessage(err);
    if (error) return { error };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  return { ok: true };
}

/** Saves the interface theme on this browser; empty means "follow the system". */
export async function setThemeAction(theme: string): Promise<void> {
  await requireUser();
  const jar = await cookies();
  if (isTheme(theme))
    jar.set(THEME_COOKIE, theme, {
      path: "/",
      maxAge: 60 * 60 * 24 * 400,
      sameSite: "lax",
      httpOnly: true,
    });
  else jar.delete(THEME_COOKIE);
}

/** Opt-in to receive the bell's notifications by email too (the person's own account). */
export async function setEmailNotificationsAction(on: boolean): Promise<void> {
  const user = await requireUser();
  await getDb()
    .update(users)
    .set({ emailNotifications: on === true })
    .where(eq(users.id, user.id));
}

export type LocaleState = { error?: string; ok?: boolean };

/** Saves the person's interface language; empty means "follow the browser". */
export async function setLocaleAction(_prev: LocaleState, form: FormData): Promise<LocaleState> {
  const user = await requireUser();
  const raw = form.get("locale");
  const parsed = localeSchema.nullable().safeParse(raw === "" || raw === null ? null : raw);
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  await getDb().update(users).set({ locale: parsed.data }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  return { ok: true };
}

export type McpConnectState = { error?: string };

const mcpProviderSchema = z.enum(mcpImageProviderIds);

/** “Connect”: start the provider's OAuth login and send the Admin's browser there. */
export async function connectMcpAction(
  _prev: McpConnectState,
  form: FormData,
): Promise<McpConnectState> {
  const admin = await requireUser();
  const provider = mcpProviderSchema.parse(form.get("provider"));
  const t = await getTranslations("settings.aiProviders.mcp");
  let url: string | null;
  try {
    url = await beginMcpConnection(getDb(), admin.actor, env, provider);
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { error: (await getTranslations("errors"))("adminOnly") };
    if (err instanceof ForgecyError && err.code === "unavailable")
      return { error: t("errors.noEncryptionKey") };
    if (err instanceof ForgecyError) return { error: t("errors.startFailed") };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  // redirect() throws, so it stays outside the try block.
  if (url) redirect(url as Route);
  return {};
}

export async function disconnectMcpAction(form: FormData): Promise<void> {
  const admin = await requireUser();
  const provider = mcpProviderSchema.parse(form.get("provider"));
  await disconnectMcp(getDb(), admin.actor, provider);
  revalidatePath("/settings/ai-providers");
}

export type RoutingState = { error?: string; ok?: boolean };

/** “Services and models”: which provider and model each kind of work uses. */
export async function saveRoutingAction(
  _prev: RoutingState,
  form: FormData,
): Promise<RoutingState> {
  const admin = await requireUser();
  const str = (k: string) => String(form.get(k) ?? "").trim();
  const images = imageProviderIds
    .map((p) => ({
      provider: p,
      model: str(`image.${p}.model`),
      position: str(`image.${p}.position`),
    }))
    .filter((i) => i.position !== "")
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map(({ provider, model }) => ({ provider, model }));
  const fallbackProvider = str("text.fallback.provider");
  const input = {
    text: {
      provider: str("text.provider"),
      model: str("text.model"),
      ...(fallbackProvider
        ? { fallback: { provider: fallbackProvider, model: str("text.fallback.model") } }
        : {}),
    },
    images,
  };
  try {
    await saveAiRoutingSettings(getDb(), admin.actor, input);
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { error: (await getTranslations("errors"))("adminOnly") };
    if (err instanceof ForgecyError && err.code === "validation")
      return { error: (await getTranslations("settings.aiProviders.routing"))("invalid") };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  revalidatePath("/settings");
  return { ok: true };
}
