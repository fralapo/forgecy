import {
  NEUTRAL_BRAND,
  findLayout,
  longTextSlide,
  renderSlideHtml,
  sampleSlide,
} from "@forgecy/carousel";
import { assertCan, canAccessClient, isLocale, type Locale } from "@forgecy/core";
import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { withUser } from "@/lib/api";
import { slideResponse, templateById } from "../../../_lib/templates";

export const dynamic = "force-dynamic";

/**
 * A layout of a catalog template version (any status) with its sample data, as the catalog and the template editor show
 * it. `?long=1` fills every slot to its limit, `?safe=1` draws the safe zone,
 * `?slots=1` outlines the slots with name and limit.
 */
export const GET = withUser(
  async (
    user,
    request: Request,
    { params }: { params: Promise<{ templateId: string; layoutId: string }> },
  ) => {
    assertCan(user.actor, "view");
    const { templateId, layoutId } = await params;
    const found = await templateById(templateId);
    // A client's private template only for people who may open that client (ADR 0020).
    const hidden = !!found?.row.clientId && !canAccessClient(user.actor, found.row.clientId);
    const pkg = hidden ? undefined : found?.pkg;
    const layout = pkg && findLayout(pkg.manifest, layoutId);
    if (!pkg || !layout) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const q = new URL(request.url).searchParams;
    const index = pkg.manifest.layouts.indexOf(layout);
    const { html } = renderSlideHtml({
      pkg,
      slide: q.get("long") === "1" ? longTextSlide(layout) : sampleSlide(layout),
      index,
      total: pkg.manifest.layouts.length,
      brand: NEUTRAL_BRAND,
      options: { showSafeZone: q.get("safe") === "1", showSlotOutlines: q.get("slots") === "1" },
      // Template previews show the labels in the language asked for, else the viewer's.
      language: isLocale(q.get("lang")) ? (q.get("lang") as Locale) : await getLocale(),
    });
    return slideResponse(html);
  },
);
