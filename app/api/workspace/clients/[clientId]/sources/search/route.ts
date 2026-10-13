import {z} from "zod";
import {auth,requireClient,json,fail,ApiFailure,dbError} from "@/lib/http";
export const runtime="nodejs";
type Params={params:Promise<{clientId:string}>};
export async function GET(request:Request,{params}:Params){
 try{
  const clientId=(await params).clientId;
  const ctx=await auth();
  await requireClient(ctx,clientId);
  const url=new URL(request.url);
  const query=z.string().trim().min(2).max(160).safeParse(url.searchParams.get("q"));
  if(!query.success)throw new ApiFailure(400,"Inserisci almeno due caratteri e non più di 160");
  const requested=Number(url.searchParams.get("limit")||8);
  const limit=Number.isInteger(requested)?Math.max(1,Math.min(20,requested)):8;
  const {data,error}=await ctx.db.rpc("forgecy_search_sources",{
   p_client_id:clientId,p_query:query.data,p_limit:limit
  });
  dbError(error,"Ricerca nelle fonti non riuscita");
  return json({query:query.data,results:data||[]});
 }catch(e){return fail(e);}
}
