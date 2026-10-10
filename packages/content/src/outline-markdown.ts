/**
 * Outline <-> Markdown. Browser-safe and pure: the outline step offers "Copy as Markdown" and
 * "Paste Markdown", and the pasted text is validated with the same outline schema the server
 * uses on save. Caption and hashtags are not part of the text; the caller keeps its own.
 *
 *   # Title
 *   Hook: ...
 *   Alt hook: ...
 *
 *   ## 1. cover | layout-id
 *   The point (may span lines)
 *   Note: optional note
 *
 *   CTA: ...
 */
import { newSlideId, outlineSchema, type Outline } from "./document";

export type OutlineMarkdownErrorCode =
  "noSlides" | "unexpectedLine" | "unknownRole" | "unknownLayout" | "tooManyAltHooks" | "invalid";

export interface OutlineMarkdownError {
  code: OutlineMarkdownErrorCode;
  /** 1-based line of the text, when the problem has one. */
  line?: number;
  /** The offending value (role, layout, schema path). */
  value?: string;
}

export type OutlineFromMarkdown =
  { ok: true; outline: Outline } | { ok: false; errors: OutlineMarkdownError[] };

export function outlineToMarkdown(
  o: Pick<Outline, "title" | "hook" | "hookAlternatives" | "rows" | "cta">,
): string {
  const out = [`# ${o.title}`, `Hook: ${o.hook}`];
  for (const a of o.hookAlternatives) out.push(`Alt hook: ${a}`);
  o.rows.forEach((r, i) => {
    out.push("", `## ${i + 1}. ${r.role} | ${r.layout}`, r.point);
    if (r.note) out.push(`Note: ${r.note}`);
  });
  out.push("", `CTA: ${o.cta}`);
  return out.join("\n") + "\n";
}

const SLIDE = /^##\s+\d+\.\s*([^|]*?)\s*\|\s*(.*?)\s*$/;
const field = (line: string, name: string) =>
  line.toLowerCase().startsWith(`${name.toLowerCase()}:`)
    ? line.slice(name.length + 1).trim()
    : null;

export function outlineFromMarkdown(
  text: string,
  allowedLayouts: readonly string[],
  allowedRoles: readonly string[],
): OutlineFromMarkdown {
  const errors: OutlineMarkdownError[] = [];
  let title = "";
  let hook = "";
  let cta = "";
  const alts: string[] = [];
  const rows: { role: string; layout: string; point: string[]; note: string }[] = [];
  let tooMany = false;

  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    const n = idx + 1;
    const cur = rows[rows.length - 1];
    const slide = SLIDE.exec(line);
    if (slide) {
      const [, role = "", layout = ""] = slide;
      if (!allowedRoles.includes(role)) errors.push({ code: "unknownRole", line: n, value: role });
      if (!allowedLayouts.includes(layout))
        errors.push({ code: "unknownLayout", line: n, value: layout });
      rows.push({ role, layout, point: [], note: "" });
      return;
    }
    if (/^#(\s|$)/.test(line) && !cur) {
      title = line.slice(1).trim();
      return;
    }
    const alt = field(line, "Alt hook");
    if (alt !== null && !cur) {
      if (alts.length >= 2) tooMany = true;
      else alts.push(alt);
      return;
    }
    const h = field(line, "Hook");
    if (h !== null && !cur) {
      hook = h;
      return;
    }
    const c = field(line, "CTA");
    if (c !== null && cur) {
      cta = c;
      return;
    }
    if (!line) return;
    if (!cur) {
      errors.push({ code: "unexpectedLine", line: n });
      return;
    }
    const note = field(line, "Note");
    if (note !== null) cur.note = note;
    else cur.point.push(line);
  });

  if (tooMany) errors.push({ code: "tooManyAltHooks" });
  if (!rows.length) errors.push({ code: "noSlides" });
  if (errors.length) return { ok: false, errors };

  const parsed = outlineSchema.safeParse({
    title,
    hook,
    hookAlternatives: alts.filter(Boolean),
    cta,
    rows: rows.map((r) => ({
      id: newSlideId(),
      role: r.role,
      layout: r.layout,
      point: r.point.join("\n"),
      note: r.note,
      edited: true,
    })),
  });
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ code: "invalid", value: i.path.join(".") })),
    };
  return { ok: true, outline: parsed.data };
}
