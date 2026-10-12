"use server";

import { appSettings, getDb, recordAuditEvent } from "@forgecy/db";
import { createMailer, renderTestEmail } from "@forgecy/mail";
import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { requireAdminAction, type AdminActionResult } from "../_lib/admin-action";
import { SMTP_TEST_KEY, type SmtpTestResult } from "./status";

/** Opens a connection and authenticates, without sending anything. */
export async function verifySmtpAction(): Promise<AdminActionResult> {
  const { denied } = await requireAdminAction("settings.manage");
  if (denied) return denied;
  const t = await getTranslations("admin.smtp");
  const mailer = createMailer(env);
  try {
    if (!mailer.configured)
      return { ok: false, error: t("status.not_configured"), code: "SMTP-NOT-CONFIGURED" };
    return (await mailer.verify())
      ? { ok: true, message: t("verify.ok") }
      : { ok: false, error: t("verify.failed"), code: "SMTP-UNREACHABLE" };
  } finally {
    mailer.close();
  }
}

export async function sendTestEmailAction(to: string): Promise<AdminActionResult> {
  const { user, denied } = await requireAdminAction("settings.manage");
  if (denied) return denied;
  const t = await getTranslations("admin.smtp");
  const parsed = z.email().safeParse(to.trim());
  if (!parsed.success) return { ok: false, error: t("test.invalid"), code: "INPUT-INVALID" };
  const mailer = createMailer(env);
  let result: SmtpTestResult;
  try {
    const message = await renderTestEmail({
      sentBy: user.name,
      locale: await getLocale(),
    });
    await mailer.sendMail({ to: parsed.data, ...message });
    result = { at: new Date().toISOString(), ok: true, by: user.id };
  } catch {
    result = { at: new Date().toISOString(), ok: false, by: user.id };
  } finally {
    mailer.close();
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .insert(appSettings)
      .values({ key: SMTP_TEST_KEY, value: result, updatedBy: user.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: result, updatedBy: user.id, updatedAt: new Date() },
      });
    await recordAuditEvent(tx, {
      actor: user.actor,
      action: "smtp_test_sent",
      entity: "app_settings",
      entityId: SMTP_TEST_KEY,
      // Only the domain: the full address is personal data the log does not need.
      meta: { ok: result.ok, toDomain: parsed.data.split("@")[1] },
    });
  });
  revalidatePath("/settings/smtp");
  return result.ok
    ? { ok: true, message: t("test.sent", { to: parsed.data }) }
    : { ok: false, error: t("test.failed"), code: "SMTP-SEND-FAILED" };
}
