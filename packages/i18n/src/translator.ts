import type { Locale } from "@forgecy/core";
import { createTranslator } from "use-intl/core";
import { messagesFor, type Messages, type Namespace } from "./messages";

/**
 * Translator for code outside React (worker, emails, client deliverables):
 * `const t = getTranslator("it", "mail"); t("magicLink.subject", { app })`.
 * The web app uses next-intl's `useTranslations` / `getTranslations` instead.
 */
export function getTranslator<N extends Namespace>(locale: Locale, namespace: N) {
  return createTranslator<Messages, N>({ locale, messages: messagesFor(locale), namespace });
}
