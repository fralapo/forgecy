import { isLocale, loadMessages, negotiateLocale, type Locale } from "@forgecy/i18n";
import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";

/** The person's saved language, otherwise the browser's, otherwise English. */
async function resolveLocale(): Promise<Locale> {
  const user = await getCurrentUser();
  if (user?.locale && isLocale(user.locale)) return user.locale;
  return negotiateLocale((await headers()).get("accept-language"));
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: await loadMessages(locale),
    // The server's zone (TZ, set from FORGECY_TIMEZONE) so server and browser format dates alike.
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
});
