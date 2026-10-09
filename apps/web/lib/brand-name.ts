/** "https://www.deodue.it/shop" → "Deodue": the first label of the host, www removed, capitalized. */
export function nameFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Callers validate first; an unreadable address gets the fallback below.
  }
  const label =
    host
      .replace(/^www\./i, "")
      .split(".")[0]
      ?.replace(/-+/g, " ")
      .trim() ?? "";
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Brand";
}

/** `base`, else `base-2`, `base-3`... the first one `taken` does not know. */
export async function uniqueSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  let slug = base;
  for (let i = 2; await taken(slug); i++) slug = `${base}-${i}`;
  return slug;
}
