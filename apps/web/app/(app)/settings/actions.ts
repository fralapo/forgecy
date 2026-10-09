"use server";

import {
  beginMcpConnection,
  beginSiwcConnection,
  byokProviderIds,
  disconnectMcp,
  disconnectSiwc,
  imageProviderIds,
  mcpImageProviderIds,
  removeAgencyApiKey,
  resolveApiKey,
  saveAiRoutingSettings,
  setAgencyApiKey,
  setSiwcClientId,
  testApiKey,
  type ByokProviderId,
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
import { resetProviders } from "@/lib/ai";
import { env } from "@/lib/env";
import { errorMessage, firstIssue, refText, vmsg } from "@/lib/i18n";
import { changeOwnPassword } from "@/lib/change-password";
import { refinePassword } from "@/lib/password-schema";
import { requireUser } from "@/lib/session";
import { isTheme, THEME_COOKIE } from "@/lib/theme";
import { emailToUsername, isValidUsername, usernameToEmail } from "@/lib/username";
import { createPasswordUser } from "@/lib/users";

const newUserSchema = z
  .object({
    username: z
      .string()
      .trim()
      .refine(isValidUsername, vmsg("validation.usernameInvalid"))
      .transform(usernameToEmail),
    password: z.string(),
    isAdmin: z
      .literal("on")
      .optional()
      .transform((v) => v === "on"),
  })
  .superRefine(refinePassword);

export type NewUserState = { error?: string; ok?: boolean };

export async function createUserAction(_prev: NewUserState, form: FormData): Promise<NewUserState> {
  const admin = await requireUser();
  assertCan(admin.actor, "users.manage");
  const parsed = newUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  const exists = await getDb().query.users.findFirst({
    where: eq(users.email, parsed.data.username),
    columns: { id: true },
  });
  if (exists) return { error: (await getTranslations("errors"))("userExists") };
  const { username: email, password, isAdmin } = parsed.data;
  await createPasswordUser({
    name: emailToUsername(email),
    email,
    password,
    isAdmin,
    createdBy: admin.id,
  });
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

export type ChangePasswordState = { error?: string; ok?: boolean };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, vmsg("validation.invalid")),
  newPassword: z.string(),
});

/** Changes the signed-in person's own password; their other devices are signed out. */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  await requireUser();
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: await firstIssue(parsed.error) };
  const result = await changeOwnPassword(parsed.data.currentPassword, parsed.data.newPassword);
  return "error" in result
    ? { error: await refText(result.error, "Invalid password.") }
    : { ok: true };
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

export type ApiKeyState = { error?: string; ok?: boolean };

const byokProviderFromForm = (form: FormData): ByokProviderId => {
  const parsed = z.enum(byokProviderIds).safeParse(form.get("provider"));
  if (!parsed.success) throw new ForgecyError("validation", "Unknown provider");
  return parsed.data;
};

/** Admin only: pastes the agency's own key for a provider, stored encrypted (never logged or sent back). */
export async function setApiKeyAction(_prev: ApiKeyState, form: FormData): Promise<ApiKeyState> {
  const admin = await requireUser();
  const t = await getTranslations("settings.aiProviders.apiKey");
  try {
    const provider = byokProviderFromForm(form);
    await setAgencyApiKey(getDb(), admin.actor, env, provider, String(form.get("apiKey") ?? ""));
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { error: (await getTranslations("errors"))("adminOnly") };
    if (err instanceof ForgecyError)
      return { error: t(`errors.${err.code === "validation" ? "empty" : "unavailable"}`) };
    throw err;
  }
  resetProviders();
  revalidatePath("/settings/ai-providers");
  return { ok: true };
}

export async function removeApiKeyAction(form: FormData): Promise<void> {
  const admin = await requireUser();
  await removeAgencyApiKey(getDb(), admin.actor, byokProviderFromForm(form));
  resetProviders();
  revalidatePath("/settings/ai-providers");
}

export type ApiKeyTestState = { tested?: true; ok?: boolean; error?: string };

/** Pasted (unsaved) key if given, else the one already configured (saved key, else env var). */
export async function testApiKeyAction(
  _prev: ApiKeyTestState,
  form: FormData,
): Promise<ApiKeyTestState> {
  await requireUser();
  const t = await getTranslations("settings.aiProviders.apiKey");
  const provider = byokProviderFromForm(form);
  const pasted = String(form.get("apiKey") ?? "").trim();
  const key = pasted || (await resolveApiKey(getDb(), env, provider));
  if (!key) return { tested: true, ok: false, error: t("errors.noneConfigured") };
  const result = await testApiKey(provider, key);
  return { tested: true, ok: result.ok, error: result.error };
}

export type SiwcConnectState = { error?: string };

/** “Continue with ChatGPT”: the person's own account, never a shared or pooled login. */
export async function connectSiwcAction(
  _prev: SiwcConnectState,
  _form: FormData,
): Promise<SiwcConnectState> {
  const user = await requireUser();
  const t = await getTranslations("settings.aiProviders.siwc");
  let url: string;
  try {
    url = await beginSiwcConnection(getDb(), user.actor, env);
  } catch (err) {
    if (err instanceof ForgecyError && err.code === "unavailable")
      return { error: t("errors.notConfigured") };
    if (err instanceof ForgecyError) return { error: t("errors.startFailed") };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  redirect(url as Route);
}

export async function disconnectSiwcAction(): Promise<void> {
  const user = await requireUser();
  await disconnectSiwc(getDb(), user.actor, env);
  revalidatePath("/settings/ai-providers");
}

export type SiwcClientIdState = { error?: string; ok?: boolean };

/** Admin only: overrides OPENAI_SIWC_CLIENT_ID from the interface once OpenAI issues one. */
export async function setSiwcClientIdAction(
  _prev: SiwcClientIdState,
  form: FormData,
): Promise<SiwcClientIdState> {
  const admin = await requireUser();
  try {
    await setSiwcClientId(getDb(), admin.actor, String(form.get("clientId") ?? ""));
  } catch (err) {
    if (err instanceof PermissionDeniedError)
      return { error: (await getTranslations("errors"))("adminOnly") };
    throw err;
  }
  revalidatePath("/settings/ai-providers");
  return { ok: true };
}
