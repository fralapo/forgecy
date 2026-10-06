import type { Locale } from "@forgecy/core";
import { createTranslator } from "use-intl/core";
import { loadMessages, type Messages, type Namespace } from "./messages";

/**
 * Translator for code outside React (worker, emails, deliverables):
 * `const t = await getTranslator("it", "mail"); t("magicLink.subject", { app })`.
 * The web app uses next-intl's `useTranslations` / `getTranslations` instead.
 */
export async function getTranslator<N extends Namespace>(locale: Locale, namespace: N) {
  const messages = await loadMessages(locale);
  return createTranslator<Messages, N>({ locale, messages, namespace });
}
