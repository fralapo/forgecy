import "server-only";
import { ForgecyError, PermissionDeniedError } from "@forgecy/core";
import { createFormat, type Messages } from "@forgecy/i18n";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

/** Locale-aware dates, numbers and lists for server components and actions. */
export async function getFormat() {
  return createFormat(await getLocale(), await getTimeZone());
}

type ValidationKey = keyof Messages["validation"];
type ValidationValues = Record<string, string | number>;

/**
 * Zod issue message that points to the `validation` namespace:
 * `z.string().min(1, vmsg("nameRequired"))`, `z.string().min(12, vmsg("passwordTooShort", { min: 12 }))`.
 */
export function vmsg(key: ValidationKey, values?: ValidationValues): string {
  return values ? `${key}|${JSON.stringify(values)}` : key;
}

/** The first Zod issue in the user's language. */
export async function firstIssue(error: ZodError): Promise<string> {
  const t = await getTranslations("validation");
  const raw = error.issues[0]?.message ?? "";
  const [key = "", json] = raw.split(/\|(.*)/s);
  if (!t.has(key as ValidationKey)) return t("invalid");
  const translate = t as unknown as (key: string, values?: ValidationValues) => string;
  return translate(key, json ? (JSON.parse(json) as ValidationValues) : undefined);
}

/**
 * What to show for an error thrown by a package: the translated message when the
 * error carries one, otherwise the English message, otherwise a message per code.
 */
export async function errorMessage(err: unknown): Promise<string | null> {
  const t = await getTranslations("errors");
  if (err instanceof PermissionDeniedError) return t("code.permission_denied");
  if (!(err instanceof ForgecyError)) return null;
  const translate = t as unknown as (key: string, values?: ValidationValues) => string;
  if (err.ref && t.has(err.ref.key as never)) return translate(err.ref.key, err.ref.values);
  return err.message || t(`code.${err.code}`);
}
