import {auth,requireClient,fail,ApiFailure,dbError} from "@/lib/http";
import {renderStrategyMarkdown,type BlueprintReport} from "@/lib/agency-reports";
export const runtime="nodejs";
type P={params:Promise<{clientId:string}>};
export async function GET(_request:Request,{params}:P){
 try{
  const clientId=(await params).clientId,ctx=await auth();
  const client=await requireClient(ctx,clientId);
  const {data,error}=await ctx.db.from("strategies")
    .select("version,status,knowledge_revision,blueprint")
    .eq("client_id",clientId).order("version",{ascending:false}).limit(1).maybeSingle();
  dbError(error);
  if(!data)throw new ApiFailure(404,"Non esiste un piano strategico da esportare");
  return new Response(renderStrategyMarkdown(client.name,data as BlueprintReport),{headers:{
   "Content-Type":"text/markdown; charset=utf-8",
   "Content-Disposition":"attachment; filename=forgecy-strategia.md",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
 }catch(e){return fail(e);}
}
