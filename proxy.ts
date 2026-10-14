import { guardApiMutation } from "./lib/request-guard";
import { authorizeRequestHost, validateTailscaleOrigin } from "./lib/tailscale-access";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const rawHost = forwardedHost?.split(",", 1)[0]?.trim() || request.headers.get("host") || request.nextUrl.host;
  let hostname: string;
  try {
    hostname = new URL(`http://${rawHost}`).hostname.toLowerCase();
  } catch {
    return NextResponse.json({ error: "Host della richiesta non valido." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const access = authorizeRequestHost({
    hostname,
    tailscaleLogin: request.headers.get("tailscale-user-login"),
    allowedTailscaleUser: process.env.FORGECY_TAILSCALE_ALLOWED_USER,
    allowedTailscaleHost: process.env.FORGECY_TAILSCALE_HOST,
  });
  if (!access.allowed)
    return NextResponse.json({ error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  const appOrigin = access.mode === "tailscale"
    ? validateTailscaleOrigin(request.headers.get("origin"), process.env.FORGECY_TAILSCALE_HOST) ?? undefined
    : process.env.APP_ORIGIN;
  if (access.mode === "tailscale" && request.method !== "GET" && request.method !== "HEAD" &&
    request.method !== "OPTIONS" && request.nextUrl.pathname.startsWith("/api/") && !appOrigin)
    return NextResponse.json({ error: "Origine Tailscale non valida." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const originCheck=guardApiMutation(request,{
    appOrigin,
    production:process.env.NODE_ENV==="production" || process.env.FORGECY_LOCAL_ONLY==="true"
  });
  if(!originCheck.ok)return NextResponse.json(
    {error:originCheck.error},
    {status:originCheck.status,headers:{"Cache-Control":"no-store"}}
  );
  return NextResponse.next({ request });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"] };
