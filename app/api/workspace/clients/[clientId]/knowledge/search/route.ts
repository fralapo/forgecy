import { z } from "zod";
import { auth, requireClient, json, fail, ApiFailure, dbError } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params:Promise<{clientId:string}> };
const searchSchema = z.string().trim().min(2).max(200);

export async function GET(request:Request,{params}:Params) {
  try {
    const ctx = await auth();
    const {clientId} = await params;
    await requireClient(ctx,clientId);
    const url = new URL(request.url);
    const query = searchSchema.parse(url.searchParams.get("q")||"");
    const count = url.searchParams.get("limit")||"10";
    if(!/^(?:[1-9]|1[0-9]|20)$/.test(count))
      throw new ApiFailure(400,"Limite di ricerca non valido");
    const limit=Number(count);
    const {data,error} = await ctx.db.rpc("forgecy_search_client_sources",{
      p_client_id:clientId,p_query:query,p_limit:limit
    });
    dbError(error,"Impossibile cercare nelle fonti del cliente");
    return json({query,hits:data||[],mode:"lexical",limit});
  }catch(error){return fail(error);}
}
