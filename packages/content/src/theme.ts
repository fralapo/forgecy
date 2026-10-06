/**
 * BrandTheme for the renderer, built from the published Brand Identity: semantic
 * color roles, the display and body fonts (only when the font file was imported,
 * so the export never falls back to a missing system font) and the primary logo.
 * A role the identity leaves empty keeps the template's own fallback.
 */
import {
  getBrandIdentityVersion,
  getPublishedBrandIdentity,
  tokenColorHex,
  type PublishedBrandIdentity,
} from "@forgecy/brand";
import { brandThemeSchema, type BrandTheme, type ColorRole } from "@forgecy/carousel";
import type { Actor } from "@forgecy/core";
import { and, brandSources, eq, inArray, isNull, type Database } from "@forgecy/db";

/** Carousel color role → token paths, first resolvable wins. */
const COLOR_PATHS: Record<ColorRole, string[]> = {
  background: ["component.slide.background", "color.semantic.background"],
  surface: ["color.semantic.surface"],
  "text.primary": ["component.slide.title", "color.semantic.text-primary"],
  "text.secondary": ["component.slide.body", "color.semantic.text-secondary"],
  accent: ["color.semantic.accent", "color.semantic.brand-primary"],
  "cta.bg": ["component.cta.background", "color.semantic.brand-primary"],
  "cta.text": ["component.cta.text", "color.semantic.on-brand-primary"],
};

const LOGO_ORDER = ["logo_primary", "wordmark", "symbol", "logo_secondary"] as const;

/** Storage keys of brand files, by brand_sources id (only the client's own, not removed). */
export type SourceKeys = ReadonlyMap<string, string>;

export function brandThemeFromIdentity(
  identity: Pick<PublishedBrandIdentity, "clientId" | "number" | "document" | "tokens">,
  options: { name?: string; handle?: string; sourceKeys?: SourceKeys } = {},
): BrandTheme {
  const keys = options.sourceKeys ?? new Map<string, string>();
  const own = (key: string | undefined) =>
    key && key.startsWith(`clients/${identity.clientId}/`) ? key : undefined;

  const colors: Partial<Record<ColorRole, string>> = {};
  for (const [role, paths] of Object.entries(COLOR_PATHS) as [ColorRole, string[]][]) {
    for (const p of paths) {
      const hex = tokenColorHex(identity.tokens, p);
      if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
        colors[role] = hex.toUpperCase();
        break;
      }
    }
  }

  const fonts: BrandTheme["fonts"] = {};
  const typography = identity.document.visual.typography.filter((t) => !t.deprecated);
  for (const [fontRole, typeRole] of [
    ["heading", "display"],
    ["body", "body"],
  ] as const) {
    const t = typography.find((x) => x.value.role === typeRole);
    const key = own(t?.value.sourceId ? keys.get(t.value.sourceId) : undefined);
    const family = t?.value.family
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 80);
    if (!t || !key || !family) continue;
    const weights = t.value.weights.filter((w) => w >= 100 && w <= 900).sort((a, b) => a - b);
    const weight =
      weights.length > 1 ? `${weights[0]} ${weights.at(-1)}` : String(weights[0] ?? 400);
    fonts[fontRole] = { family, key, weight, style: "normal" };
  }

  let logo: BrandTheme["logo"];
  const variants = identity.document.visual.logo.variants;
  for (const role of LOGO_ORDER) {
    const v = variants.find((x) => x.role === role && x.background !== "dark" && x.sourceId);
    const key = own(v?.sourceId ? keys.get(v.sourceId) : undefined);
    if (key) {
      logo = { key, alt: options.name ? `Logo ${options.name}` : "Logo", focalX: 0.5, focalY: 0.5 };
      break;
    }
  }

  return brandThemeSchema.parse({
    name: options.name ?? "",
    handle: options.handle ?? "",
    colors,
    fonts,
    ...(logo ? { logo } : {}),
    version: `v${identity.number}`,
  });
}

/** Storage keys of the brand files a theme may reference. */
export async function brandSourceKeys(
  db: Database,
  clientId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const uuids = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!uuids.length) return new Map();
  const rows = await db
    .select({ id: brandSources.id, key: brandSources.storageKey })
    .from(brandSources)
    .where(
      and(
        eq(brandSources.clientId, clientId),
        inArray(brandSources.id, uuids),
        isNull(brandSources.removedAt),
      ),
    );
  return new Map(rows.filter((r) => r.key).map((r) => [r.id, r.key!]));
}

function referencedSources(identity: Pick<PublishedBrandIdentity, "document">): string[] {
  const v = identity.document.visual;
  return [
    ...v.typography.map((t) => t.value.sourceId),
    ...v.logo.variants.map((l) => l.sourceId),
  ].filter((x): x is string => Boolean(x));
}

export interface LoadedBrand {
  identity: PublishedBrandIdentity;
  theme: BrandTheme;
}

/**
 * The brand a carousel renders with: the published version, or the version pinned on
 * the content (so a later Brand Identity doesn't silently restyle approved work).
 */
export async function loadBrand(
  db: Database,
  actor: Actor,
  input: { clientId: string; clientName: string; versionId?: string | null },
): Promise<LoadedBrand | null> {
  const identity = input.versionId
    ? await getBrandIdentityVersion(db, actor, {
        clientId: input.clientId,
        versionId: input.versionId,
      })
    : await getPublishedBrandIdentity(db, actor, input.clientId);
  if (!identity) return null;
  const keys = await brandSourceKeys(db, input.clientId, referencedSources(identity));
  return {
    identity,
    theme: brandThemeFromIdentity(identity, { name: input.clientName, sourceKeys: keys }),
  };
}
