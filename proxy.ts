import { guardApiMutation } from "./lib/request-guard";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const originCheck=guardApiMutation(request,{
    appOrigin:process.env.APP_ORIGIN,
    production:process.env.NODE_ENV==="production"
  });
  if(!originCheck.ok)return NextResponse.json(
    {error:originCheck.error},
    {status:originCheck.status,headers:{"Cache-Control":"no-store"}}
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookies: Array<{name:string; value:string; options?:{httpOnly?:boolean; secure?:boolean; domain?:string; path?:string; maxAge?:number; sameSite?:boolean|"lax"|"strict"|"none"}}>) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  await supabase.auth.getUser();
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"] };
