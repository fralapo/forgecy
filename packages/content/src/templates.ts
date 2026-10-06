/**
 * Templates a carousel can use: published versions of the catalog (M3) assigned to
 * every client or to this one. The manifest comes from the row, so choosing a
 * template, the outline and the slide schema never need the package from storage.
 */
import { compareVersions } from "@forgecy/carousel/catalog";
import {
  findLayout,
  templateManifestSchema,
  type FormatId,
  type LayoutDef,
  type SlideRole,
  type TemplateManifest,
} from "@forgecy/carousel";
import { and, eq, inArray, isNull, or, templates, type Database } from "@forgecy/db";
import { notFound } from "./access";

export interface UsableTemplate {
  key: string;
  version: string;
  name: string;
  description: string;
  format: FormatId;
  channel: string;
  manifest: TemplateManifest;
}

function parseRow(row: typeof templates.$inferSelect): UsableTemplate | null {
  const r = templateManifestSchema.safeParse(row.manifest);
  // Only carousel templates bound to a channel (report templates have none).
  if (!r.success || r.data.kind !== "carousel" || !r.data.channel) return null;
  return {
    key: row.key,
    version: row.version,
    name: row.name,
    description: r.data.description,
    format: r.data.format,
    channel: r.data.channel,
    manifest: r.data,
  };
}

/** Newest published version of each carousel template the client may use. */
export async function listUsableTemplates(
  db: Database,
  clientId: string,
  filter: { format?: FormatId } = {},
): Promise<UsableTemplate[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.status, "published"),
        eq(templates.kind, "carousel"),
        or(isNull(templates.clientId), eq(templates.clientId, clientId)),
        filter.format ? eq(templates.format, filter.format) : undefined,
      ),
    );
  const newest = new Map<string, typeof templates.$inferSelect>();
  for (const row of rows) {
    const cur = newest.get(row.key);
    if (!cur || compareVersions(row.version, cur.version) > 0) newest.set(row.key, row);
  }
  return [...newest.values()]
    .map(parseRow)
    .filter((t): t is UsableTemplate => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

/**
 * The template of a carousel: the pinned version (published or archived, so old
 * carousels keep working) or, when none is pinned, the newest published one.
 */
export async function getTemplate(
  db: Database,
  clientId: string,
  key: string,
  version?: string | null,
): Promise<UsableTemplate> {
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.key, key),
        version ? eq(templates.version, version) : undefined,
        inArray(templates.status, version ? ["published", "archived"] : ["published"]),
        or(isNull(templates.clientId), eq(templates.clientId, clientId)),
      ),
    );
  const row = rows.sort((a, b) => compareVersions(b.version, a.version))[0];
  const parsed = row ? parseRow(row) : null;
  if (!parsed) notFound(`Template “${key}” not available`);
  return parsed;
}

/** Slide count clamped to what the template allows. */
export function clampSlideCount(m: TemplateManifest, n: number | null | undefined): number {
  const v = n ?? m.slides.default;
  return Math.min(m.slides.max, Math.max(m.slides.min, v));
}

/** Layouts usable for a role, honoring the first/last position rules. */
export function layoutsForRole(
  m: TemplateManifest,
  role: SlideRole,
  position: "first" | "middle" | "last",
): LayoutDef[] {
  return m.layouts.filter(
    (l) =>
      l.role === role &&
      (l.position === "any" ||
        (l.position === "first" && position === "first") ||
        (l.position === "last" && position === "last")),
  );
}

/** Best layout for a row of the outline; falls back to any layout allowed at that position. */
export function pickLayout(
  m: TemplateManifest,
  role: SlideRole,
  index: number,
  total: number,
  wanted?: string,
): LayoutDef {
  const position = index === 0 ? "first" : index === total - 1 ? "last" : "middle";
  const fits = (l: LayoutDef) =>
    l.position === "any" ||
    (l.position === "first" && position === "first") ||
    (l.position === "last" && position === "last");
  const w = wanted ? findLayout(m, wanted) : undefined;
  if (w && fits(w) && w.role === role) return w;
  return (
    layoutsForRole(m, role, position)[0] ??
    m.layouts.find((l) => fits(l) && l.role !== "cta" && l.role !== "cover") ??
    m.layouts.find(fits) ??
    m.layouts[0]!
  );
}

/** Default roles for n slides: cover, body roles of the template, CTA last. */
export function defaultRoles(m: TemplateManifest, n: number): SlideRole[] {
  const has = (r: SlideRole) => m.layouts.some((l) => l.role === r);
  const body = [...new Set(m.layouts.map((l) => l.role))].filter(
    (r) => r !== "cover" && r !== "cta",
  );
  const roles: SlideRole[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 && has("cover")) roles.push("cover");
    else if (i === n - 1 && n > 1 && has("cta")) roles.push("cta");
    else roles.push(body[(i - 1 + body.length) % Math.max(body.length, 1)] ?? "text");
  }
  return roles;
}
