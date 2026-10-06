import type { BadgeProps } from "@forgecy/ui";
import type { ContentStatus, ContentVersionOrigin } from "@forgecy/core";

export const statusVariant: Record<ContentStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  in_review: "warning",
  changes_requested: "error",
  approved: "success",
  exported: "success",
  archived: "neutral",
};

export const versionOriginLabels: Record<ContentVersionOrigin, string> = {
  ai: "Generata dall'AI",
  manual: "Salvata a mano",
  restore: "Ripristino",
  submit: "Invio in revisione",
};

export const outlineOriginLabels = {
  ai: "Copywriter",
  manual: "Modifica manuale",
  restore: "Ripristino",
} as const;

const jobLabels: Record<string, string> = {
  "content.generate_outline": "Generazione della scaletta",
  "content.generate_slides": "Generazione delle slide",
  "content.edit_slide": "Modifica di una slide",
  "content.generate_image": "Generazione delle immagini",
  "content.export": "Esportazione",
};
export const jobLabel = (kind: string) => jobLabels[kind] ?? "Lavoro in corso";

/** Short Italian name of the storage file kinds of an export. */
export const outputLabels = { png: "PNG", pdf: "PDF", zip: "ZIP" } as const;
