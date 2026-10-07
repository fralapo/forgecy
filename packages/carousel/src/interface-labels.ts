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
