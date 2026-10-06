import {
  NEUTRAL_BRAND,
  findLayout,
  longTextSlide,
  renderSlideHtml,
  sampleSlide,
} from "@forgecy/carousel";
import { assertCan } from "@forgecy/core";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { slideResponse, templateSource } from "../../../_lib/templates";

export const dynamic = "force-dynamic";

/**
 * A template layout with its sample data, as the catalog and the template editor show
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
    const pkg = await templateSource.get(templateId);
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
    });
    return slideResponse(html);
  },
);
