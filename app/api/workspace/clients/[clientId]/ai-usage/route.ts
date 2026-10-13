import {auth,requireClient,fail,json,dbError,ApiFailure} from "@/lib/http";
export const runtime="nodejs";

type Group = {
  provider:string;operation:string;model:string;
  calls:number;token_reported_calls:number;cost_reported_calls:number;
  prompt_tokens:number;completion_tokens:number;reported_cost_usd:number|null;
};
function nonnegative(value:unknown):number{
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:0;
}

/** Owner-scoped, read-only provider observations; no prompts or external IDs. */
export async function GET(request:Request,{params}:{params:Promise<{clientId:string}>}){
 try{
  const id=(await params).clientId,ctx=await auth();
  await requireClient(ctx,id);
  const raw=new URL(request.url).searchParams.get("days")||"30";
  if(!/^(?:[1-9]|[1-8][0-9]|90)$/.test(raw))
    throw new ApiFailure(400,"Seleziona un periodo tra 1 e 90 giorni");
  const days=Number(raw);
  const {data,error}=await ctx.db.rpc("forgecy_client_ai_usage_summary",{
    p_client_id:id,p_days:days
  });
  dbError(error,"Il registro dei consumi AI non è disponibile. Verifica la migrazione 0017.");
  const groups:Group[]=(data||[]).map((entry:Record<string,unknown>)=>({
    provider:String(entry.provider||""),
    operation:String(entry.operation||""),
    model:String(entry.model||""),
    calls:nonnegative(entry.calls),
    token_reported_calls:nonnegative(entry.token_reported_calls),
    cost_reported_calls:nonnegative(entry.cost_reported_calls),
    prompt_tokens:nonnegative(entry.prompt_tokens),
    completion_tokens:nonnegative(entry.completion_tokens),
    reported_cost_usd:entry.reported_cost_usd===null?null:nonnegative(entry.reported_cost_usd)
  }));
  const calls=groups.reduce((sum,g)=>sum+g.calls,0);
  const costedCalls=groups.reduce((sum,g)=>sum+g.cost_reported_calls,0);
  return json({days,groups,totals:{
    calls,token_reported_calls:groups.reduce((s,g)=>s+g.token_reported_calls,0),
    cost_reported_calls:costedCalls,
    prompt_tokens:groups.reduce((s,g)=>s+g.prompt_tokens,0),
    completion_tokens:groups.reduce((s,g)=>s+g.completion_tokens,0),
    reported_cost_usd:costedCalls?Number(groups.reduce((s,g)=>s+(g.reported_cost_usd??0),0).toFixed(9)):null,
    cost_partial:costedCalls<calls
  },scope:"provider-reported; no guarantee of complete usage or spend cap"});
 }catch(error){return fail(error)}
}
