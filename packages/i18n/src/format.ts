import type { Locale } from "@forgecy/core";
import { intlLocale } from "./locales";

type DateInput = Date | string | number;

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value));

export const dateStyles = {
  /** 6 Oct 2026 */
  date: { dateStyle: "medium" },
  /** 6 October 2026 */
  long: { dateStyle: "long" },
  /** 06/10/2026 */
  short: { dateStyle: "short" },
  /** 6 Oct 2026, 14:05 */
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  /** 14:05 */
  time: { timeStyle: "short" },
  /** October 2026 */
  month: { month: "long", year: "numeric" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof dateStyles;

/** Locale-aware formatting helpers bound to one language and time zone. */
export function createFormat(locale: Locale, timeZone?: string) {
  const tag = intlLocale(locale);
  return {
    date(value: DateInput, style: DateStyle = "date"): string {
      return new Intl.DateTimeFormat(tag, { ...dateStyles[style], timeZone }).format(toDate(value));
    },
    number(value: number, options?: Intl.NumberFormatOptions): string {
      return new Intl.NumberFormat(tag, options).format(value);
    },
    percent(value: number, maximumFractionDigits = 0): string {
      return new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits }).format(value);
    },
    currency(value: number, currency: string): string {
      return new Intl.NumberFormat(tag, { style: "currency", currency }).format(value);
    },
    list(items: string[], type: Intl.ListFormatType = "conjunction"): string {
      return new Intl.ListFormat(tag, { style: "long", type }).format(items);
    },
    relative(value: DateInput, now: Date = new Date()): string {
      const seconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ["year", 31_536_000],
        ["month", 2_592_000],
        ["week", 604_800],
        ["day", 86_400],
        ["hour", 3_600],
        ["minute", 60],
      ];
      for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
      }
      return rtf.format(seconds, "second");
    },
  };
}

export type Format = ReturnType<typeof createFormat>;
