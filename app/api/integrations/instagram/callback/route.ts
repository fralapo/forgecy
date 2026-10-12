import { createHmac,timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auth,requireClient,ApiFailure,audit } from "@/lib/http";
import { encrypt } from "@/lib/crypto";
export const runtime="nodejs";

async function graph(url:URL){
 const response=await fetch(url.toString(),{signal:AbortSignal.timeout(12000),cache:"no-store"});
 const data=await response.json();
 if(!response.ok)throw new ApiFailure(502,"Meta API: autorizzazione non completata");
 return data;
}
export async function GET(request:Request){
 const base=new URL(request.url);
 const back=new URL("/workspace",base.origin);
 back.searchParams.set("view","results");
 const outcome=(message:string)=>{back.searchParams.set("integration",message);return NextResponse.redirect(back);};
 try{
  const ctx=await auth();
  const secret=process.env.META_APP_SECRET,appId=process.env.META_APP_ID,redirect=process.env.META_REDIRECT_URI;
  if(!secret||!appId||!redirect)throw new ApiFailure(503,"Meta non configurato");
  const state=base.searchParams.get("state")||"";
  const decoded=Buffer.from(state,"base64url").toString("utf8");
  const parts=decoded.split(":");
  if(parts.length!==5)throw new ApiFailure(403,"Sessione OAuth non valida");
  const [userId,clientId,nonce,issued,signature]=parts;
  const unsigned=parts.slice(0,4).join(":");
  const expected=createHmac("sha256",secret).update(unsigned).digest("hex");
  if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(expected),Buffer.from(signature))||
     userId!==ctx.user.id){
     throw new ApiFailure(403,"Verifica OAuth non riuscita");
  }
  const {cookies}=await import("next/headers");
  if((await cookies()).get("forgecy_ig_oauth")?.value!==nonce||Date.now()-Number(issued)>600000)
    throw new ApiFailure(403,"Sessione OAuth scaduta");
  await requireClient(ctx,clientId);
  back.searchParams.set("clientId",clientId);
  const code=base.searchParams.get("code");
  if(!code)throw new ApiFailure(400,"Autorizzazione Meta annullata");
  const ver=process.env.META_GRAPH_VERSION||"v23.0";
  const tokenUrl=new URL("https://graph.facebook.com/"+ver+"/oauth/access_token");
  tokenUrl.searchParams.set("client_id",appId);
  tokenUrl.searchParams.set("client_secret",secret);
  tokenUrl.searchParams.set("redirect_uri",redirect);
  tokenUrl.searchParams.set("code",code);
  const token=await graph(tokenUrl) as {access_token:string};
  const longUrl=new URL("https://graph.facebook.com/"+ver+"/oauth/access_token");
  longUrl.searchParams.set("grant_type","fb_exchange_token");
  longUrl.searchParams.set("client_id",appId);
  longUrl.searchParams.set("client_secret",secret);
  longUrl.searchParams.set("fb_exchange_token",token.access_token);
  const long=await graph(longUrl) as {access_token:string,expires_in?:number};
  const pagesUrl=new URL("https://graph.facebook.com/"+ver+"/me/accounts");
  pagesUrl.searchParams.set("fields","id,name,access_token,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("access_token",long.access_token);
  const pages=await graph(pagesUrl) as {data?:Array<{access_token?:string,instagram_business_account?:{id:string,username?:string}}>};
  let count=0;
  for(const page of pages.data||[]){
   const ig=page.instagram_business_account;
   if(!ig?.id)continue;
   const saved=await ctx.db.from("social_accounts").upsert({
    client_id:clientId,platform:"instagram",remote_id:ig.id,username:ig.username||"",
    token_ciphertext:encrypt(page.access_token||long.access_token),
    token_expires_at:long.expires_in?new Date(Date.now()+long.expires_in*1000).toISOString():null
   },{onConflict:"client_id,platform,remote_id"});
   if(saved.error)throw new ApiFailure(500,"Impossibile salvare il collegamento Instagram");
   count++;
  }
  if(count===0)return outcome("Nessun account Instagram professionale associato alle Pagine autorizzate");
  await audit(ctx,clientId,"instagram_connected",undefined,{accounts:count});
  const response=outcome("Instagram collegato: "+count+" account");
  response.cookies.delete("forgecy_ig_oauth");
  return response;
 }catch(error){
  console.error("[meta callback]",error instanceof Error?error.message:"Errore");
  return outcome("Collegamento Instagram non riuscito: controlla permessi e configurazione");
 }
}
