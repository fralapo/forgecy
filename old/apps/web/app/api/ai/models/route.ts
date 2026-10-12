import { assertCan } from "@forgecy/core";
import {
  byokProviderIds,
  fetchModelCatalog,
  resolveApiKey,
  type ByokProviderId,
} from "@forgecy/ai";
import { getDb } from "@forgecy/db";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function isByokProvider(value: string | null): value is ByokProviderId {
  return !!value && (byokProviderIds as readonly string[]).includes(value);
}

/**
 * A BYOK provider's live model catalog, for the searchable model field on Settings >
 * AI providers (see live-model-field.tsx). Admin only. OpenRouter's catalog is public;
 * the other three need the agency's own pasted key (or env var) — with none configured,
 * this returns an empty list rather than an error, so the field just falls back to free
 * text. `kind=image` keeps only models that can generate images (the image-provider
 * fields); anything else (including an absent `kind`) keeps only the rest, so a text
 * field never suggests an image-only model and vice versa.
 */
export const GET = withUser(async (user, request: Request) => {
  assertCan(user.actor, "ai.providers.manage");
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider");
  if (!isByokProvider(provider))
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  const wantImages = params.get("kind") === "image";
  try {
    const apiKey =
      provider === "openrouter" ? undefined : await resolveApiKey(getDb(), env, provider);
    const models = await fetchModelCatalog(provider, apiKey);
    return NextResponse.json({
      // Newest first, capped so the page's datalist stays light; any other id still
      // works if typed or pasted directly, the cap only limits what's suggested.
      models: models
        .filter((m) => m.imageCapable === wantImages)
        .sort((a, b) => b.created - a.created)
        .slice(0, 400),
    });
  } catch {
    return NextResponse.json({ models: [] });
  }
});
