import { assertCan } from "@forgecy/core";
import { fetchOpenRouterCatalog } from "@forgecy/ai";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * OpenRouter's model catalog, for the searchable model field on Settings > AI providers
 * (see routing-form.tsx). Admin only, like the rest of that page; a fetch failure (no
 * internet, OpenRouter down) returns an empty list rather than an error, so the field
 * just falls back to free text.
 */
export const GET = withUser(async (user) => {
  assertCan(user.actor, "ai.providers.manage");
  try {
    const models = await fetchOpenRouterCatalog();
    return NextResponse.json({
      // Newest first, capped so the page's datalist stays light; any other id still
      // works if typed or pasted directly, the cap only limits what's suggested.
      models: [...models].sort((a, b) => b.created - a.created).slice(0, 400),
    });
  } catch {
    return NextResponse.json({ models: [] });
  }
});
