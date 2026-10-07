import { completeMcpConnection } from "@forgecy/ai";
import { getDb } from "@forgecy/db";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect of the MCP providers (Higgsfield). The Admin who clicked
 * “Connect” lands here; the result shows on Settings > AI providers.
 */
export async function GET(req: NextRequest) {
  const back = new URL("/settings/ai-providers", env.FORGECY_BASE_URL);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", env.FORGECY_BASE_URL));
  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  if (!state) {
    back.searchParams.set("mcp", "error");
    return NextResponse.redirect(back);
  }
  try {
    const provider = await completeMcpConnection(getDb(), user.actor, env, {
      state,
      code: params.get("code"),
      error: params.get("error_description") ?? params.get("error"),
    });
    back.searchParams.set("mcp", "connected");
    back.searchParams.set("provider", provider);
  } catch {
    // The reason is stored on the connection (last_error) and shown on the page.
    back.searchParams.set("mcp", "error");
  }
  return NextResponse.redirect(back);
}
