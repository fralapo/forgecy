"use client";

import { createFormat, type Locale } from "@forgecy/i18n";
import { useLocale, useTimeZone } from "next-intl";
import { useMemo } from "react";

/** Locale-aware dates, numbers and lists for client components. */
export function useFormat() {
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  return useMemo(() => createFormat(locale, timeZone), [locale, timeZone]);
}
