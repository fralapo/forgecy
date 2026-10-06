/** Visible length in code points (what the template limits count). */
export function textLength(text: string): number {
  return [...text].length;
}

/**
 * Fit a text into `max` characters: cut at the last space and add an ellipsis.
 * Highlight markers (`==`) from people or agents are neutralized: only the
 * report builder decides what is highlighted.
 */
export function fitText(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/==/g, "=").replace(/\s+/g, " ").trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}
