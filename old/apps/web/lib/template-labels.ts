import { DEFAULT_LOCALE, isLocale, type Locale } from "@forgecy/core";
import { localizeManifest, type TemplateManifest } from "@forgecy/carousel";
import { getLocale } from "next-intl/server";

/** The reader's interface language as a Forgecy locale. */
export async function interfaceLocale(): Promise<Locale> {
  const locale = await getLocale();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/**
 * Template texts (name, description, layout and slot names) in the reader's interface language,
 * from the template's `interface/<code>.json`; English where it has none. Display only.
 */
export async function getManifestLocalizer() {
  const lang = await interfaceLocale();
  return <M extends TemplateManifest | null | undefined>(m: M): M =>
    (m ? localizeManifest(m, lang) : m) as M;
}
