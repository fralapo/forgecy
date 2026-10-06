import { z } from "zod";
import {
  type LayoutDef,
  type ListSlotDef,
  type TextSlotDef,
  type TemplateManifest,
  findLayout,
  slideRoleLabels,
} from "./template-schema";

/**
 * A slide is data, never markup: a layout id plus one value per slot. The AI and the
 * editor only ever produce this JSON; the renderer inserts every value as text.
 */
export const imageRefSchema = z
  .object({
    /** Storage key of an approved asset (`clients/<id>/assets/<sha>.png`). */
    key: z.string().min(1).max(1024).optional(),
    /** File inside the template package (`assets/...`), for samples and decorations. */
    asset: z.string().min(1).max(200).optional(),
    alt: z.string().max(300).default(""),
    /** Focal point 0–1, used as `object-position`. */
    focalX: z.number().min(0).max(1).default(0.5),
    focalY: z.number().min(0).max(1).default(0.5),
  })
  .refine(
    (r) => Boolean(r.key) !== Boolean(r.asset),
    "Give either an asset (key) or a template file",
  );
export type ImageRef = z.infer<typeof imageRefSchema>;

export const slotValueSchema = z.union([
  z.string().max(2000),
  z.array(z.string().max(500)).max(12),
  imageRefSchema,
]);
export type SlotValue = z.infer<typeof slotValueSchema>;

export const slideSchema = z.object({
  /** Stable id inside the carousel (editor, comments); optional for previews. */
  id: z.string().max(64).optional(),
  layout: z.string().min(1).max(40),
  /** Color variant the template may style with `[data-tone="inverse"]`. */
  tone: z.enum(["default", "inverse"]).default("default"),
  slots: z.record(z.string(), slotValueSchema).default({}),
});
export type Slide = z.infer<typeof slideSchema>;
export type SlideInput = z.input<typeof slideSchema>;

// Control characters other than newline would break the text layout silently.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/;
const MARK = /==/g;

/** Visible characters of a slot value: code points, highlight markers excluded. */
export function visibleLength(text: string): number {
  return [...text.replace(MARK, "")].length;
}

function checkText(
  slot: TextSlotDef | ListSlotDef,
  text: string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
) {
  if (CONTROL.test(text))
    ctx.addIssue({ code: "custom", path, message: "Control characters are not allowed" });
  const len = visibleLength(text);
  if (len > slot.maxChars)
    ctx.addIssue({
      code: "custom",
      path,
      message: `“${slot.label ?? slot.name}”: ${len} characters out of ${slot.maxChars}`,
      params: { reason: "too_long", length: len, max: slot.maxChars },
    });
  if (slot.type === "text" && slot.maxLines && text.split("\n").length > slot.maxLines)
    ctx.addIssue({
      code: "custom",
      path,
      message: `“${slot.label ?? slot.name}”: at most ${slot.maxLines} lines`,
    });
  if (!slot.highlight && text.includes("=="))
    ctx.addIssue({ code: "custom", path, message: "Highlighting is not allowed in this slot" });
}

/** Check one slide against its layout; issues land on `ctx` with paths relative to the slide. */
export function checkSlideAgainstLayout(
  slide: Slide,
  layout: LayoutDef,
  ctx: z.RefinementCtx,
  base: (string | number)[] = [],
): void {
  const declared = new Map(layout.slots.map((s) => [s.name, s]));
  for (const name of Object.keys(slide.slots)) {
    if (!declared.has(name))
      ctx.addIssue({
        code: "custom",
        path: [...base, "slots", name],
        message: `Slot "${name}" does not exist in layout ${layout.id}`,
      });
  }
  for (const slot of layout.slots) {
    const path = [...base, "slots", slot.name];
    const value = slide.slots[slot.name];
    const empty =
      value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (slot.required)
        ctx.addIssue({
          code: "custom",
          path,
          message: `“${slot.label ?? slot.name}” is required`,
        });
      continue;
    }
    if (slot.type === "text") {
      if (typeof value !== "string") {
        ctx.addIssue({ code: "custom", path, message: "Expected a text" });
        continue;
      }
      checkText(slot, value, ctx, path);
    } else if (slot.type === "list") {
      if (!Array.isArray(value)) {
        ctx.addIssue({ code: "custom", path, message: "Expected a list of texts" });
        continue;
      }
      if (value.length > slot.maxItems || value.length < slot.minItems)
        ctx.addIssue({
          code: "custom",
          path,
          message: `“${slot.label ?? slot.name}”: ${slot.minItems} to ${slot.maxItems} items`,
        });
      value.forEach((item, i) => {
        // An empty item would export as a blank numbered row.
        if (item.trim() === "")
          ctx.addIssue({
            code: "custom",
            path: [...path, i],
            message: `“${slot.label ?? slot.name}”: item ${i + 1} is empty`,
          });
        else checkText(slot, item, ctx, [...path, i]);
      });
    } else if (typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({ code: "custom", path, message: "Expected an image" });
    }
  }
}

/** Zod schema for one slide of `template`: what generate_slides validates the AI output with. */
export function buildSlideSchema(template: TemplateManifest) {
  const ids = template.layouts.map((l) => l.id) as [string, ...string[]];
  return slideSchema.extend({ layout: z.enum(ids) }).superRefine((slide, ctx) => {
    const layout = findLayout(template, slide.layout);
    if (layout) checkSlideAgainstLayout(slide, layout, ctx);
  });
}

/** Schema for a whole carousel: slide count and composition rules of the template. */
export function buildCarouselSchema(template: TemplateManifest) {
  const one = buildSlideSchema(template);
  return z.array(one).superRefine((slides, ctx) => {
    const { min, max } = template.slides;
    if (slides.length < min || slides.length > max)
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `The template allows ${min} to ${max} slides (now ${slides.length})`,
      });
    slides.forEach((s, i) => {
      const layout = findLayout(template, s.layout);
      if (!layout) return;
      const label = slideRoleLabels[layout.role];
      if (layout.position === "first" && i !== 0)
        ctx.addIssue({
          code: "custom",
          path: [i, "layout"],
          message: `${label}: only as the first slide`,
        });
      if (layout.position === "last" && i !== slides.length - 1)
        ctx.addIssue({
          code: "custom",
          path: [i, "layout"],
          message: `${label}: only as the last slide`,
        });
      if (template.rules.ctaOnlyLast && layout.role === "cta" && i !== slides.length - 1)
        ctx.addIssue({
          code: "custom",
          path: [i, "layout"],
          message: "The CTA goes only on the last slide",
        });
      const images = layout.slots.filter((sl) => sl.type === "image" && s.slots[sl.name]).length;
      if (images > template.rules.maxImagesPerSlide)
        ctx.addIssue({
          code: "custom",
          path: [i, "slots"],
          message: `At most ${template.rules.maxImagesPerSlide} images per slide`,
        });
    });
  });
}

/** Sample slide for a layout, from the values declared in template.json. */
export function sampleSlide(layout: LayoutDef): Slide {
  return slideSchema.parse({ id: `sample-${layout.id}`, layout: layout.id, slots: layout.sample });
}

const FILLER = "Sample text as long as the slot limit to check that it does not overflow its box ";

function fill(max: number): string {
  let s = "";
  while ([...s].length < max) s += FILLER;
  return [...s].slice(0, max).join("").trimEnd();
}

/** “Long texts”: every text slot filled up to its limit, every list to its max items. */
export function longTextSlide(layout: LayoutDef): Slide {
  const slots: Record<string, unknown> = { ...layout.sample };
  for (const slot of layout.slots) {
    if (slot.type === "text") slots[slot.name] = fill(slot.maxChars);
    else if (slot.type === "list")
      slots[slot.name] = Array.from({ length: slot.maxItems }, () => fill(slot.maxChars));
  }
  return slideSchema.parse({ id: `long-${layout.id}`, layout: layout.id, slots });
}
