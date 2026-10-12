import { DEFAULT_LOCALE, isLocale, type Locale } from "@forgecy/core";
import type { TemplatePackage } from "./package";
import {
  type TemplateInterfaceLabels,
  templateInterfaceLabelsSchema,
  type TemplateManifest,
} from "./template-schema";

/**
 * Interface texts of a template (its name and description, layout and slot names) follow the
 * interface language of whoever looks at them, unlike the printed labels in `locales/`, which
 * follow the deliverable. English is written in template.json; every other language is one file,
 * `interface/<code>.json`, with only the texts it translates:
 *
 * { "name": "Editoriale", "layouts": { "cover": { "name": "Copertina", "slots": { "title": "Titolo" } } } }
 */
export const TEMPLATE_INTERFACE_DIR = "interface";

// Not `readText` from ./package: package.ts imports this module.
const decoder = new TextDecoder("utf-8", { fatal: false });
const readText = (pkg: Pick<TemplatePackage, "files">, path: string) => {
  const bytes = pkg.files.get(path);
  return bytes ? decoder.decode(bytes) : undefined;
};

function parseLabels(raw: string | undefined): TemplateInterfaceLabels | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = templateInterfaceLabelsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The package's interface files by language (English and unreadable files left out). */
export function readInterfaceLabels(
  pkg: Pick<TemplatePackage, "files">,
): Record<string, TemplateInterfaceLabels> {
  const prefix = `${TEMPLATE_INTERFACE_DIR}/`;
  const out: Record<string, TemplateInterfaceLabels> = {};
  for (const path of pkg.files.keys()) {
    if (!path.startsWith(prefix) || !path.endsWith(".json")) continue;
    const code = path.slice(prefix.length, -".json".length);
    if (!isLocale(code) || code === DEFAULT_LOCALE) continue;
    const labels = parseLabels(readText(pkg, path));
    if (labels) out[code] = labels;
  }
  return out;
}

/** The manifest with the package's interface files stored in `translations`. */
export function withInterfaceLabels(
  manifest: TemplateManifest,
  files: TemplatePackage["files"],
): TemplateManifest {
  const fromFiles = readInterfaceLabels({ files });
  if (!Object.keys(fromFiles).length) return manifest;
  return { ...manifest, translations: { ...manifest.translations, ...fromFiles } };
}

/**
 * The manifest with its interface texts in `locale`, English where a text is not translated.
 * For display only: ids, slot names and limits are unchanged.
 */
export function localizeManifest(manifest: TemplateManifest, locale: Locale): TemplateManifest {
  const labels = locale === DEFAULT_LOCALE ? undefined : manifest.translations?.[locale];
  if (!labels) return manifest;
  return {
    ...manifest,
    name: labels.name ?? manifest.name,
    description: labels.description ?? manifest.description,
    rules: { ...manifest.rules, notes: labels.notes ?? manifest.rules.notes },
    layouts: manifest.layouts.map((layout) => {
      const l = labels.layouts?.[layout.id];
      if (!l) return layout;
      return {
        ...layout,
        name: l.name ?? layout.name,
        slots: layout.slots.map((slot) => {
          const label = l.slots?.[slot.name];
          return label ? { ...slot, label } : slot;
        }),
      };
    }),
  };
}

/**
 * The name a person sees for a slot of a layout: its interface label (the manifest localized
 * with `localizeManifest`), or the slot key when the template gives none.
 */
export function slotDisplayName(
  manifest: Pick<TemplateManifest, "layouts"> | null | undefined,
  layoutId: string | null | undefined,
  slot: string,
  source?: Pick<TemplateManifest, "layouts"> | null,
): string {
  const slots = manifest?.layouts.find((l) => l.id === layoutId)?.slots ?? [];
  // `source` is the same manifest before `localizeManifest`: the guard messages name a slot by
  // its template label (English) rather than its key, so match on either, then read the
  // localized slot at the same position.
  const from = source?.layouts.find((l) => l.id === layoutId)?.slots ?? slots;
  const at = from.findIndex((s) => s.name === slot);
  const i = at >= 0 ? at : from.findIndex((s) => (s.label ?? s.name) === slot);
  return slots[i]?.label ?? slot;
}

/**
 * A message reference whose `slot` value is shown as the slot's interface label, for display.
 * Refs without a `slot` value come back unchanged; stored data and the English text are not touched.
 */
export function labelSlotRef<R extends { values?: Record<string, string | number> | undefined }>(
  ref: R | null | undefined,
  manifest: Pick<TemplateManifest, "layouts"> | null | undefined,
  layoutId: string | null | undefined,
  source?: Pick<TemplateManifest, "layouts"> | null,
): R | undefined {
  const slot = ref?.values?.slot;
  if (!ref || typeof slot !== "string") return ref ?? undefined;
  return {
    ...ref,
    values: { ...ref.values, slot: slotDisplayName(manifest, layoutId, slot, source) },
  };
}

export type StockOrientation = "portrait" | "landscape" | "square";

/**
 * Photo orientation an image slot wants: from its minimum size when the template sets both,
 * otherwise from the slide canvas (a slot without a minimum is taken to fill the slide).
 */
export function imageSlotOrientation(
  slot: { minWidth?: number | undefined; minHeight?: number | undefined },
  canvas: { width: number; height: number },
): StockOrientation {
  const both = slot.minWidth !== undefined && slot.minHeight !== undefined;
  const w = both ? slot.minWidth! : canvas.width;
  const h = both ? slot.minHeight! : canvas.height;
  return w > h ? "landscape" : h > w ? "portrait" : "square";
}

export interface InterfaceLabelProblem {
  path: string;
  message: string;
}

/** Problems with a package's interface files: unreadable files, unknown layouts or slots. */
export function checkInterfaceLabels(pkg: TemplatePackage): InterfaceLabelProblem[] {
  const problems: InterfaceLabelProblem[] = [];
  const prefix = `${TEMPLATE_INTERFACE_DIR}/`;
  for (const path of pkg.files.keys()) {
    if (!path.startsWith(prefix) || !path.endsWith(".json")) continue;
    const code = path.slice(prefix.length, -".json".length);
    if (!isLocale(code)) {
      problems.push({ path, message: `"${code}" is not a supported language` });
      continue;
    }
    const labels = parseLabels(readText(pkg, path));
    if (!labels) {
      problems.push({ path, message: "is not a valid interface labels file" });
      continue;
    }
    for (const [id, l] of Object.entries(labels.layouts ?? {})) {
      const layout = pkg.manifest.layouts.find((x) => x.id === id);
      if (!layout) {
        problems.push({ path, message: `unknown layout "${id}"` });
        continue;
      }
      for (const slot of Object.keys(l.slots ?? {}))
        if (!layout.slots.some((s) => s.name === slot))
          problems.push({ path, message: `unknown slot "${slot}" in layout "${id}"` });
    }
  }
  return problems;
}
