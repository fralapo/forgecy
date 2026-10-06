import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic redirect for signed-out visitors. It only checks that a session cookie
 * exists; every page and route still validates the session on the server.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Public: auth API, health, signed file URLs, login, first-run setup, static assets.
  // The client package upload checks the session itself: through the proxy its body
  // would be buffered in memory (and cut at proxyClientMaxBodySize).
  matcher: [
    "/((?!api/auth|api/health|api/files|login|setup|settings/import-export/upload|_next/static|_next/image|favicon.ico).*)",
  ],
};
