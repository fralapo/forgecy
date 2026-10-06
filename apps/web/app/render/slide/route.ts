import { brandThemeSchema, renderSlideHtml, slideSchema } from "@forgecy/carousel";
import { collectAssetKeys, resolveAssets } from "@forgecy/carousel/node";
import { assertCan } from "@forgecy/core";
import { createStorageFromEnv } from "@forgecy/files";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";
import { slideResponse, templateSource } from "../_lib/templates";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  templateId: z.string().min(1).max(64),
  templateVersion: z.string().max(20).optional(),
  slide: slideSchema,
  index: z.number().int().min(0).max(19).default(0),
  total: z.number().int().min(1).max(20).default(1),
  brand: brandThemeSchema.optional(),
  /** Required as soon as the slide or the brand points at stored assets. */
  clientId: z.uuid().optional(),
  options: z
    .object({
      showSafeZone: z.boolean().default(false),
      showSlotOutlines: z.boolean().default(false),
      watermark: z.literal("Bozza").optional(),
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
  const pkg = await templateSource.get(body.templateId, body.templateVersion);
  if (!pkg) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const keys = collectAssetKeys([body.slide], body.brand ?? brandThemeSchema.parse({}));
  if (keys.length && !body.clientId)
    return NextResponse.json(
      { error: "validation", message: "clientId obbligatorio con asset" },
      { status: 422 },
    );
  const assets = keys.length
    ? await resolveAssets(createStorageFromEnv(env), body.clientId!, keys)
    : undefined;

  const { html } = renderSlideHtml({
    pkg,
    slide: body.slide,
    index: body.index,
    total: body.total,
    ...(body.brand ? { brand: body.brand } : {}),
    ...(assets ? { assets } : {}),
    options: body.options,
  });
  return slideResponse(html);
});
