import "server-only";
import { appSettings, eq, getDb } from "@forgecy/db";

export const SMTP_TEST_KEY = "smtp.last_test";

export interface SmtpTestResult {
  at: string;
  ok: boolean;
  by: string;
}

export async function lastSmtpTest(): Promise<SmtpTestResult | null> {
  const [row] = await getDb()
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, SMTP_TEST_KEY));
  return (row?.value as SmtpTestResult | undefined) ?? null;
}
