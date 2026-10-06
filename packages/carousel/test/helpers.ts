import path from "node:path";
import { readTemplateDir } from "../src/node";
import { packageFromFiles, type TemplatePackage } from "../src/package";

export const TEMPLATES = path.resolve(import.meta.dirname, "../../../templates");

export async function loadRepoTemplate(folder: string): Promise<TemplatePackage> {
  return packageFromFiles(await readTemplateDir(path.join(TEMPLATES, folder)));
}

const enc = new TextEncoder();

/** Minimal package for edge cases: one layout, files given as text. */
export function miniPackage(
  overrides: {
    html?: string;
    css?: string;
    manifest?: Record<string, unknown>;
    extra?: Record<string, Uint8Array>;
  } = {},
) {
  const manifest = {
    id: "mini-test",
    name: "Mini",
    version: "1.0.0",
    channel: "instagram",
    format: "ig_4x5",
    width: 1080,
    height: 1350,
    slides: { min: 1, max: 3, default: 1 },
    styles: ["styles.css"],
    fonts: [],
    colorRoles: {
      "--fc-bg": { role: "background", fallback: "#FFFFFF" },
      "--fc-text": { role: "text.primary", fallback: "#111111" },
    },
    typeScale: [32, 64],
    layouts: [
      {
        id: "only",
        name: "Only",
        role: "text",
        file: "layouts/only.html",
        slots: [
          { name: "title", type: "text", maxChars: 40, required: true, highlight: true },
          { name: "items", type: "list", maxItems: 3, maxChars: 30 },
        ],
        sample: { title: "Hello" },
      },
    ],
    ...overrides.manifest,
  };
  const files = new Map<string, Uint8Array>([
    ["template.json", enc.encode(JSON.stringify(manifest))],
    [
      "layouts/only.html",
      enc.encode(
        overrides.html ??
          `<div class="box"><h1 data-slot="title"></h1><ul data-slot="items"><li></li></ul></div>`,
      ),
    ],
    [
      "styles.css",
      enc.encode(
        overrides.css ?? `.box{background:var(--fc-bg);color:var(--fc-text);font-size:32px}`,
      ),
    ],
    ...Object.entries(overrides.extra ?? {}),
  ]);
  return files;
}
