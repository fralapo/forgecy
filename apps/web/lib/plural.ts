const rules = new Intl.PluralRules("it-IT");

/**
 * "1 modifica" / "3 modifiche": picks the Italian form with Intl.PluralRules
 * (Italian has only "one" and "other"; 0 takes the plural).
 */
export function plural(n: number, one: string, other: string): string {
  return `${n.toLocaleString("it-IT")} ${rules.select(n) === "one" ? one : other}`;
}
