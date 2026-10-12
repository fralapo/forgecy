import { brandThemeSchema, renderSlideHtml, slideSchema } from "@forgecy/carousel";
import { collectAssetKeys, resolveAssets } from "@forgecy/carousel/node";
import { assertCan, DEFAULT_LOCALE, localeSchema } from "@forgecy/core";
import { getTranslator } from "@forgecy/i18n";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api";
import { catalogSource, getStorage, slideResponse } from "../_lib/templates";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  templateId: z.string().min(1).max(64),
  templateVersion: z.string().max(32).optional(),
  slide: slideSchema,
  index: z.number().int().min(0).max(19).default(0),
  total: z.number().int().min(1).max(20).default(1),
  brand: brandThemeSchema.optional(),
  /** Required as soon as the slide or the brand points at stored assets. */
  clientId: z.uuid().optional(),
  /** Language of the deliverable: printed labels and the draft watermark. */
  language: localeSchema.default(DEFAULT_LOCALE),
  options: z
    .object({
      showSafeZone: z.boolean().default(false),
      showSlotOutlines: z.boolean().default(false),
      watermark: z.literal("Draft").optional(),
    })
    .default({ showSafeZone: false, showSlotOutlines: false }),
});

/**
 * Preview of any slide with the export renderer (editor canvas). Returns the same HTML
 * the export worker photographs, so what the editor shows is what gets exported.
 */
export const POST = withUser(async (user, request: Request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 422 });
  const body = parsed.data;
  assertCan(user.actor, "view", body.clientId);
  const pkg = await catalogSource(body.clientId ?? null).get(body.templateId, body.templateVersion);
  if (!pkg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const keys = collectAssetKeys([body.slide], body.brand ?? brandThemeSchema.parse({}));
  if (keys.length && !body.clientId)
    return NextResponse.json(
      { error: "validation", message: "clientId is required with assets" },
      { status: 422 },
    );
  const assets = keys.length ? await resolveAssets(getStorage(), body.clientId!, keys) : undefined;

  const { html } = renderSlideHtml({
    pkg,
    slide: body.slide,
    index: body.index,
    total: body.total,
    ...(body.brand ? { brand: body.brand } : {}),
    ...(assets ? { assets } : {}),
    options: {
      ...body.options,
      ...(body.options.watermark
        ? { watermark: getTranslator(body.language, "deliverable")("draftWatermark") }
        : {}),
    },
    language: body.language,
  });
  return slideResponse(html);
});
