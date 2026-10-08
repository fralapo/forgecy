/**
 * Untrusted text inside prompts (OWASP LLM01: segregate and clearly denote external
 * content). The tags are formatting, not a security boundary, but the escape must at
 * least be correct. We ESCAPE the `<` of a delimiter-looking sequence instead of
 * deleting it: deleting is defeated by nesting (`</da</data>ta>` collapses back to
 * `</data>`), while `&lt;` leaves no `<` to rebuild a tag from, and a second pass
 * changes nothing. Only delimiter tags are touched, so ordinary `<` in text survives
 * (verbatim-quote checks keep working for everything but literal `<data` text).
 */
export const DELIMITER_TAGS = ["data", "document", "files", "page"] as const;

export function escapeDelimiters(text: string, tags: readonly string[] = DELIMITER_TAGS): string {
  const delimiter = new RegExp(`<(?=\\s*/?\\s*(?:${tags.join("|")})(?![\\w-]))`, "gi");
  return text.replace(delimiter, "&lt;");
}

/** A value for a quoted attribute or a one-line field: no quotes, angle brackets or line breaks. */
export function inlineValue(value: string, max = 200): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f"<>]/g, " ").trim().slice(0, max);
}
