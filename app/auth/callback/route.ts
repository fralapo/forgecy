import { NextResponse } from "next/server";
import { serverDb } from "@/lib/supabase";
export async function GET(request:Request){
 const url=new URL(request.url);
 const code=url.searchParams.get("code");
 const dest=new URL("/workspace",url.origin);
 if(!code) return NextResponse.redirect(new URL("/login?error=missing_code",url.origin));
 const db=await serverDb();
 const {error}=await db.auth.exchangeCodeForSession(code);
 if(error) return NextResponse.redirect(new URL("/login?error=auth_failed",url.origin));
 return NextResponse.redirect(dest);
}
