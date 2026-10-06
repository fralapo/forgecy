import type { BrandTheme } from "./brand";
import { FORMATS } from "./formats";
import type { TemplatePackage } from "./package";
import type { Slide } from "./slide-schema";
import { findLayout, slideRoleLabels } from "./template-schema";

/** What travels with the files: provenance written into slides.json and the PDF metadata. */
export interface ExportMetadata {
  client: string;
  content: string;
  version: number;
  brandIdentityVersion?: string;
  /** AI models used to write or illustrate the slides. */
  models?: string[];
  /** ISO date the version was approved; also the fixed date inside PDF and ZIP. */
  approvedAt?: string;
}

export interface CarouselTexts {
  caption?: string;
  hashtags?: string[];
}

function hashtagLine(tags: string[] = []): string {
  return tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
}

/** `caption.txt`: caption, a blank line, the hashtags. */
export function captionText(t: CarouselTexts): string {
  return [t.caption?.trim() ?? "", hashtagLine(t.hashtags)].filter(Boolean).join("\n\n") + "\n";
}

function slotText(v: unknown): string[] {
  if (typeof v === "string") return [v.replace(/==/g, "")];
  if (Array.isArray(v)) return v.map((i) => `- ${String(i).replace(/==/g, "")}`);
  if (v && typeof v === "object" && "alt" in v) {
    const alt = String((v as { alt?: string }).alt ?? "");
    return alt ? [`Image alt text: ${alt}`] : [];
  }
  return [];
}

/** `texts.md`: the copy of every slide, alt texts included, in slide order. */
export function slidesMarkdown(
  pkg: TemplatePackage,
  slides: Slide[],
  meta: ExportMetadata,
  texts: CarouselTexts,
): string {
  const out = [
    `# ${meta.content}`,
    "",
    `${meta.client} · version ${meta.version} · ${FORMATS[pkg.manifest.format].label}`,
    "",
  ];
  slides.forEach((s, i) => {
    const layout = findLayout(pkg.manifest, s.layout);
    out.push(`## Slide ${i + 1} · ${layout ? slideRoleLabels[layout.role] : s.layout}`, "");
    for (const slot of layout?.slots ?? []) {
      const lines = slotText(s.slots[slot.name]);
      if (lines.length) out.push(...lines, "");
    }
  });
  if (texts.caption || texts.hashtags?.length)
    out.push("## Caption", "", captionText(texts).trimEnd(), "");
  return out.join("\n");
}

/** `slides.json`: structure, contents and provenance of the export. */
export function slidesJson(
  pkg: TemplatePackage,
  slides: Slide[],
  meta: ExportMetadata,
  texts: CarouselTexts,
  brand: BrandTheme,
): string {
  const m = pkg.manifest;
  return (
    JSON.stringify(
      {
        format: m.format,
        width: m.width,
        height: m.height,
        template: { id: m.id, version: m.version, name: m.name },
        brandIdentityVersion: meta.brandIdentityVersion ?? brand.version ?? null,
        models: meta.models ?? [],
        client: meta.client,
        content: meta.content,
        version: meta.version,
        approvedAt: meta.approvedAt ?? null,
        caption: texts.caption ?? "",
        hashtags: texts.hashtags ?? [],
        slides,
      },
      null,
      2,
    ) + "\n"
  );
}
