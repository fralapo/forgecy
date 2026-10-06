import { z } from "zod";

/**
 * Languages Forgecy speaks, for the interface and for client deliverables.
 * English is the source language and the fallback: every key exists in English first.
 * Adding a language: add its code here and a folder in packages/i18n/messages (see docs/I18N.md).
 */
export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const localeSchema = z.enum(LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
