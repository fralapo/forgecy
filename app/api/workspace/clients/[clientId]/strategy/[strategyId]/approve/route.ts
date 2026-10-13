import {z} from "zod";
import {auth,requireClient,json,fail,ApiFailure,dbError} from "@/lib/http";
export const runtime="nodejs";
type P={params:Promise<{clientId:string;strategyId:string}>};
export async function POST(_request:Request,{params}:P){
 try{
  const {clientId,strategyId}=await params;
  if(!z.uuid().safeParse(strategyId).success)throw new ApiFailure(400,"ID strategia non valido");
  const ctx=await auth();await requireClient(ctx,clientId);
  const result=await ctx.db.rpc("approve_forgecy_strategy",{
    p_client_id:clientId,p_strategy_id:strategyId
  });
  dbError(result.error,"Strategia non approvabile: verifica il dossier e le fonti");
  return json({approved:result.data});
 }catch(e){return fail(e);}
}
