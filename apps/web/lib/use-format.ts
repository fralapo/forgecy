"use client";

import type { MessageRef } from "@forgecy/core";
import { createFormat, type Locale, type MessageValues } from "@forgecy/i18n";
import { useLocale, useTimeZone, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

/** Locale-aware dates, numbers and lists for client components. */
export function useFormat() {
  const locale = useLocale() as Locale;
  const timeZone = useTimeZone();
  return useMemo(() => createFormat(locale, timeZone), [locale, timeZone]);
}

/** Text of a stored message reference (job errors...), else the English fallback. */
export function useRefText() {
  const t = useTranslations();
  return useCallback(
    (ref: MessageRef | null | undefined, fallback: string) => {
      if (!ref || !t.has(ref.key as never)) return fallback;
      return (t as unknown as (key: string, values?: MessageValues) => string)(ref.key, ref.values);
    },
    [t],
  );
}
