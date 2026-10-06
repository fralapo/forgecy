const rules = new Intl.PluralRules("en-GB");

/**
 * "1 change" / "3 changes": picks the English form with Intl.PluralRules
 * (English has only "one" and "other"; 0 takes the plural).
 */
export function plural(n: number, one: string, other: string): string {
  return `${n.toLocaleString("en-GB")} ${rules.select(n) === "one" ? one : other}`;
}
