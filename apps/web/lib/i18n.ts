import "server-only";
import { ForgecyError, PermissionDeniedError, type MessageRef } from "@forgecy/core";
import { createFormat, type MessageKey, type MessageValues } from "@forgecy/i18n";
import { getLocale, getTimeZone, getTranslations } from "next-intl/server";
import type { ZodError } from "zod";

/** Locale-aware dates, numbers and lists for server components and actions. */
export async function getFormat() {
  return createFormat(await getLocale(), await getTimeZone());
}

type Translate = (key: string, values?: MessageValues) => string;

/** Root translator that accepts a key known only at runtime (stored or thrown references). */
async function translator(): Promise<{ t: Translate; has: (key: string) => boolean }> {
  const t = await getTranslations();
  return { t: t as unknown as Translate, has: (key) => t.has(key as never) };
}

/**
 * Zod issue message pointing to a message key:
 * `z.string().min(1, vmsg("validation.nameRequired"))`,
 * `z.string().min(12, vmsg("validation.passwordTooShort", { min: 12 }))`.
 */
export function vmsg(key: MessageKey, values?: MessageValues): string {
  return values ? `${key}|${JSON.stringify(values)}` : key;
}

/** The first Zod issue in the user's language. */
export async function firstIssue(error: ZodError): Promise<string> {
  const { t, has } = await translator();
  const raw = error.issues[0]?.message ?? "";
  const [key = "", json] = raw.split(/\|(.*)/s);
  if (!has(key)) return t("validation.invalid");
  return t(key, json ? (JSON.parse(json) as MessageValues) : undefined);
}

/** A stored or thrown message reference in the user's language, else the English fallback. */
export async function refText(
  ref: MessageRef | null | undefined,
  fallback: string,
): Promise<string> {
  return (await getRefText())(ref, fallback);
}

/** `refText` as a synchronous function, for lists rendered in a `map`. */
export async function getRefText() {
  const { t, has } = await translator();
  return (ref: MessageRef | null | undefined, fallback: string): string =>
    ref && has(ref.key) ? t(ref.key, ref.values) : fallback;
}

/**
 * What to show for an error thrown by a package: the translated message when the
 * error carries one, otherwise the English message, otherwise a message per code.
 */
export async function errorMessage(err: unknown): Promise<string | null> {
  const { t } = await translator();
  if (err instanceof PermissionDeniedError) return t("errors.code.permission_denied");
  if (!(err instanceof ForgecyError)) return null;
  return refText(err.ref, err.message || t(`errors.code.${err.code}`));
}
