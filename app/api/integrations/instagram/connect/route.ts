import { createHmac,randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth,requireClient,fail,ApiFailure } from "@/lib/http";
export const runtime="nodejs";

export async function GET(request:Request){
 try{
  const ctx=await auth();
  const clientId=new URL(request.url).searchParams.get("clientId")||"";
  await requireClient(ctx,clientId);
  const appId=process.env.META_APP_ID,secret=process.env.META_APP_SECRET,redirect=process.env.META_REDIRECT_URI;
  if(!appId||!secret||!redirect)throw new ApiFailure(503,"Meta non configurato");
  const nonce=randomBytes(20).toString("hex");
  const issued=Date.now();
  const message=[ctx.user.id,clientId,nonce,issued].join(":");
  const sig=createHmac("sha256",secret).update(message).digest("hex");
  const state=Buffer.from(message+":"+sig).toString("base64url");
  const version=process.env.META_GRAPH_VERSION||"v23.0";
  const url=new URL("https://www.facebook.com/"+version+"/dialog/oauth");
  url.searchParams.set("client_id",appId);
  url.searchParams.set("redirect_uri",redirect);
  url.searchParams.set("state",state);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope","pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights");
  const response=NextResponse.redirect(url);
  response.cookies.set("forgecy_ig_oauth",nonce,{
   httpOnly:true,secure:process.env.NODE_ENV==="production",
   sameSite:"lax",maxAge:600,path:"/"
  });
  return response;
 }catch(e){return fail(e)}
}
