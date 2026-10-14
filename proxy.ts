import { guardApiMutation } from "./lib/request-guard";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname.toLowerCase();
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1")
    return NextResponse.json({ error: "Forgecy è disponibile solo su questo computer" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const originCheck=guardApiMutation(request,{
    appOrigin:process.env.APP_ORIGIN,
    production:process.env.NODE_ENV==="production" || process.env.FORGECY_LOCAL_ONLY==="true"
  });
  if(!originCheck.ok)return NextResponse.json(
    {error:originCheck.error},
    {status:originCheck.status,headers:{"Cache-Control":"no-store"}}
  );
  return NextResponse.next({ request });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"] };
