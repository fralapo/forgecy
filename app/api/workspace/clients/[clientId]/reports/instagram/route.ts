import {z} from "zod";
import {auth,requireClient,fail,ApiFailure,dbError} from "@/lib/http";
import {instagramCsv} from "@/lib/agency-reports";
import type {ObservedSnapshot} from "@/lib/social-analytics";
export const runtime="nodejs";
type P={params:Promise<{clientId:string}>};
export async function GET(request:Request,{params}:P){
 try{
  const clientId=(await params).clientId,ctx=await auth();
  await requireClient(ctx,clientId);
  const raw=new URL(request.url).searchParams.get("accountId");
  if(raw&&!z.uuid().safeParse(raw).success)throw new ApiFailure(400,"ID account non valido");
  const {data:accounts,error:accountError}=await ctx.db.from("social_accounts")
    .select("id").eq("client_id",clientId).limit(20);
  dbError(accountError);
  const requested=raw||accounts?.[0]?.id;
  if(!requested||!accounts?.some(a=>a.id===requested))
    throw new ApiFailure(404,"Account Instagram non collegato a questo cliente");
  const {data,error}=await ctx.db.from("social_snapshots").select("*")
   .eq("client_id",clientId).eq("account_id",requested)
   .order("collected_at",{ascending:true}).limit(1000);
  dbError(error);
  const measured=(data||[]).filter(snapshot=>snapshot.data?.measured===true);
  if(!measured.length)
   throw new ApiFailure(404,"Non ci sono statistiche reali esportabili");
  return new Response(instagramCsv(measured as ObservedSnapshot[]),{headers:{
   "Content-Type":"text/csv; charset=utf-8",
   "Content-Disposition":"attachment; filename=forgecy-instagram.csv",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
 }catch(e){return fail(e);}
}
