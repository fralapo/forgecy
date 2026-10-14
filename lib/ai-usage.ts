import {AsyncLocalStorage} from "node:async_hooks";
import {workerDb} from "./worker-db";
import {withUserTextModel} from "./ai-model-settings";

export type AiUsageOperation = "chat"|"adapt"|"dossier"|"strategy"|"mission"|"image";
export type AiUsageRecord = {
  client_id:string;requested_by:string;job_id:string|null;
  operation:AiUsageOperation;provider:"openrouter"|"openai";
  provider_request_id:string|null;model:string;
  prompt_tokens:number|null;completion_tokens:number|null;
  total_tokens:number|null;reported_cost_usd:number|null;
  usage_status:"reported"|"unavailable";
};
type Scope = {
  clientId:string;requestedBy:string;operation:AiUsageOperation;
  jobId?:string;
  /** Test-only dependency injection; production records locally in SQLite. */
  writer?:(record:AiUsageRecord)=>Promise<void>;
};
const storage=new AsyncLocalStorage<Scope>();

export async function withAiUsageScope<T>(scope:Scope,work:()=>Promise<T>):Promise<T> {
  if(scope.operation==="image") return storage.run(scope,work);
  return withUserTextModel(scope.requestedBy,()=>storage.run(scope,work));
}
function quantity(value:unknown,integer:boolean):number|null {
  const parsed=typeof value==="number"?value:
    (typeof value==="string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)?Number(value):NaN);
  if(!Number.isFinite(parsed)||parsed<0||parsed>1e12||(integer&&!Number.isSafeInteger(parsed)))return null;
  return parsed;
}
function asObject(value:unknown):Record<string,unknown> {
  return value!==null&&typeof value==="object"&&!Array.isArray(value)?
    value as Record<string,unknown>:{};
}

/** Provider data only: never derive or estimate cost from a model price list. */
export function providerUsageRecord(
  scope:Pick<Scope,"clientId"|"requestedBy"|"operation"|"jobId">,
  provider:"openrouter"|"openai",requestedModel:string,response:unknown
):AiUsageRecord{
  const data=asObject(response),usage=asObject(data.usage);
  const prompt=quantity(provider==="openrouter"?usage.prompt_tokens:usage.input_tokens,true);
  const completion=quantity(provider==="openrouter"?usage.completion_tokens:usage.output_tokens,true);
  const total=quantity(usage.total_tokens,true);
  const cost=provider==="openrouter"?quantity(usage.cost,false):null;
  const actualModel=provider==="openrouter"&&typeof data.model==="string"&&data.model.trim()?
    data.model:requestedModel;
  const external=provider==="openrouter"&&typeof data.id==="string"&&data.id.length<=160?
    data.id:null;
  return {
    client_id:scope.clientId,requested_by:scope.requestedBy,job_id:scope.jobId||null,
    operation:scope.operation,provider,provider_request_id:external,
    model:actualModel.slice(0,180),
    prompt_tokens:prompt,completion_tokens:completion,total_tokens:total,
    reported_cost_usd:cost,
    usage_status:[prompt,completion,total,cost].some(v=>v!==null)?"reported":"unavailable"
  };
}

/**
 * Best-effort post-response accounting. Never retry a billable provider request
 * because storage is unavailable: this ledger is observability, NOT a hard cap.
 */
export async function recordAiProviderUsage(
  provider:"openrouter"|"openai",model:string,response:unknown
):Promise<void>{
  const scope=storage.getStore();
  if(!scope)return;
  const record=providerUsageRecord(scope,provider,model,response);
  try{
    if(scope.writer){await scope.writer(record);return;}
    const db=workerDb();
    const {error}=await db.from("ai_provider_usage").insert(record);
    // An idempotent provider response may be observed twice after a retry.
    if(error && error.code!=="23505")throw new Error(error.code||"usage insert failed");
  }catch(error){
    // Do not include provider response, prompt, customer data or credentials in logs.
    console.error("[ai-usage] Could not persist provider usage",error instanceof Error?error.message:"unknown");
  }
}
