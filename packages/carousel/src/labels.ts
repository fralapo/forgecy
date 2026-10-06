import { DEFAULT_LOCALE, isLocale, type Locale } from "@forgecy/core";
import { readText, type TemplatePackage } from "./package";

/**
 * Printed labels of a template ("Swipe", "Prepared by"...). Layouts mark them with
 * `data-fc-text="<key>"` and the package carries one file per language,
 * `locales/<code>.json` (`{ "swipe": "Scorri" }`). They follow the deliverable's
 * language, never the interface language of whoever renders it.
 */
export const TEMPLATE_LOCALES_DIR = "locales";

export type TemplateTexts = Record<string, string>;

function readTexts(pkg: Pick<TemplatePackage, "files">, language: string): TemplateTexts {
  const raw = readText(pkg, `${TEMPLATE_LOCALES_DIR}/${language}.json`);
  if (raw === undefined) return {};
  try {
    const json: unknown = JSON.parse(raw);
    if (!json || typeof json !== "object" || Array.isArray(json)) return {};
    return Object.fromEntries(
      Object.entries(json).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

/** Labels in `language`, with English for any key the language file lacks. */
export function templateTexts(
  pkg: Pick<TemplatePackage, "files">,
  language: Locale = DEFAULT_LOCALE,
): TemplateTexts {
  const base = readTexts(pkg, DEFAULT_LOCALE);
  return language === DEFAULT_LOCALE ? base : { ...base, ...readTexts(pkg, language) };
}

/** Languages the template has label files for. */
export function templateLanguages(pkg: Pick<TemplatePackage, "files">): Locale[] {
  const prefix = `${TEMPLATE_LOCALES_DIR}/`;
  return [...pkg.files.keys()]
    .filter((p) => p.startsWith(prefix) && p.endsWith(".json"))
    .map((p) => p.slice(prefix.length, -".json".length))
    .filter(isLocale);
}

export interface TemplateTextProblem {
  path: string;
  message: string;
}

/**
 * Problems with a template's labels: unreadable language files, and keys used by a
 * layout that the English file (the fallback) does not define.
 */
export function checkTemplateTexts(pkg: TemplatePackage): TemplateTextProblem[] {
  const problems: TemplateTextProblem[] = [];
  const prefix = `${TEMPLATE_LOCALES_DIR}/`;
  for (const path of pkg.files.keys()) {
    if (!path.startsWith(prefix) || !path.endsWith(".json")) continue;
    try {
      const json: unknown = JSON.parse(readText(pkg, path) ?? "");
      if (
        !json ||
        typeof json !== "object" ||
        Array.isArray(json) ||
        Object.values(json).some((v) => typeof v !== "string")
      )
        problems.push({ path, message: "must be an object of texts" });
    } catch {
      problems.push({ path, message: "is not valid JSON" });
    }
  }
  const english = readTexts(pkg, DEFAULT_LOCALE);
  for (const layout of pkg.manifest.layouts) {
    const html = readText(pkg, layout.file) ?? "";
    for (const [, key] of html.matchAll(/data-fc-text="([^"]+)"/g)) {
      if (key && !(key in english))
        problems.push({
          path: layout.file,
          message: `label "${key}" is missing from ${prefix}${DEFAULT_LOCALE}.json`,
        });
    }
  }
  return problems;
}
