import { auth,requireClient,fail,json,ApiFailure,dbError,audit } from "@/lib/http";
import { decrypt } from "@/lib/crypto";
export const runtime="nodejs";
export const maxDuration=45;

async function graph(url:URL){
 const response=await fetch(url.toString(),{signal:AbortSignal.timeout(12000),cache:"no-store"});
 if(!response.ok)throw new ApiFailure(502,"Impossibile leggere i dati Instagram (HTTP "+response.status+")");
 return response.json();
}
export async function POST(_request:Request,{params}:{params:Promise<{clientId:string}>}){
 try{
  const id=(await params).clientId,ctx=await auth();
  await requireClient(ctx,id);
  const {data,error}=await ctx.db.from("social_accounts").select("id,remote_id,username,token_ciphertext,token_expires_at").eq("client_id",id).eq("platform","instagram");
  dbError(error);
  if(!data?.length)throw new ApiFailure(409,"Collega prima Instagram");
  const ver=process.env.META_GRAPH_VERSION||"v23.0";
  const snapshots=[];
  for(const a of data){
   if(a.token_expires_at && Date.parse(a.token_expires_at)<Date.now())throw new ApiFailure(401,"Token Meta scaduto: ricollega l'account");
   const token=decrypt(a.token_ciphertext);
   const accountUrl=new URL("https://graph.facebook.com/"+ver+"/"+encodeURIComponent(a.remote_id));
   accountUrl.searchParams.set("fields","id,username,followers_count,media_count");
   accountUrl.searchParams.set("access_token",token);
   const mediaUrl=new URL("https://graph.facebook.com/"+ver+"/"+encodeURIComponent(a.remote_id)+"/media");
   mediaUrl.searchParams.set("fields","id,caption,media_type,permalink,timestamp,like_count,comments_count");
   mediaUrl.searchParams.set("limit","50");mediaUrl.searchParams.set("access_token",token);
   const [account,media]=await Promise.all([graph(accountUrl),graph(mediaUrl)]);
   const collected={account,media:media.data||[],source:"Meta Instagram Graph API",measured:true};
   const {data:row,error:saveError}=await ctx.db.from("social_snapshots").insert({
    client_id:id,account_id:a.id,data:collected,period:"latest_50_posts"
   }).select("id,collected_at").single();
   dbError(saveError,"Statistiche non salvate");
   snapshots.push({username:a.username,...row});
  }
  await audit(ctx,id,"instagram_synced",undefined,{accounts:snapshots.length});
  return json({snapshots});
 }catch(e){return fail(e)}
}
