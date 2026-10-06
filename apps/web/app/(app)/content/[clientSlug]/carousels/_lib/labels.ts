import type { BadgeProps } from "@forgecy/ui";
import type { ContentStatus } from "@forgecy/core";

export const statusVariant: Record<ContentStatus, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  in_review: "warning",
  changes_requested: "error",
  approved: "success",
  exported: "success",
  archived: "neutral",
};

/** Message key (under `content.labels.job`) of a job kind of this module. */
const jobKeys = {
  "content.creative_direction": "creativeDirection",
  "content.generate_outline": "generateOutline",
  "content.generate_slides": "generateSlides",
  "content.edit_slide": "editSlide",
  "content.generate_image": "generateImage",
  "content.export": "export",
} as const;
export const jobKey = (kind: string) => jobKeys[kind as keyof typeof jobKeys] ?? "other";

/** Short name of the storage file kinds of an export. */
export const outputLabels = { png: "PNG", pdf: "PDF", zip: "ZIP" } as const;
