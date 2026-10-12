import type { Locale, Messages } from "@forgecy/i18n";

// Typed keys: `t("shell.nav.clients")` fails to compile if the key is not in the English files.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
