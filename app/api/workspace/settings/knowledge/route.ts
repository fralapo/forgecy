import { z } from "zod";
import { ApiFailure, auth, dbError, fail, json, read } from "@/lib/http";
import { indexNextKnowledgeBatch, knowledgeEmbeddingCounts } from "@/lib/knowledge-index";
import { LOCAL_EMBEDDING_MODEL_ID, localEmbeddingRuntimeStatus } from "@/lib/local-embeddings";

export const runtime="nodejs";

export async function GET(){
 try{
  const ctx=await auth();
  const {data,error}=await ctx.db.from("ai_preferences").select("semantic_enabled")
   .eq("owner_id",ctx.user.id).maybeSingle();
  dbError(error,"Impossibile leggere le preferenze di ricerca");
  return json({enabled:Boolean(data?.semantic_enabled),...knowledgeEmbeddingCounts(),
   modelId:LOCAL_EMBEDDING_MODEL_ID,runtime:localEmbeddingRuntimeStatus()});
 }catch(error){return fail(error);}
}

const preferenceSchema=z.object({enabled:z.boolean()}).strict();
export async function PATCH(request:Request){
 try{
  const ctx=await auth();
  const {enabled}=await read(request,preferenceSchema);
  const current=await ctx.db.from("ai_preferences").select("text_model,image_model")
   .eq("owner_id",ctx.user.id).maybeSingle();
  dbError(current.error,"Impossibile leggere le preferenze locali");
  const saved=await ctx.db.from("ai_preferences").upsert({
   owner_id:ctx.user.id,text_model:current.data?.text_model||null,
   image_model:current.data?.image_model||null,semantic_enabled:enabled?1:0,
   updated_at:new Date().toISOString()
  },{onConflict:"owner_id"}).select("semantic_enabled").single();
  dbError(saved.error,"Impossibile salvare la preferenza di ricerca");
  return json({enabled:Boolean(saved.data?.semantic_enabled)});
 }catch(error){return fail(error);}
}

const indexSchema=z.object({batchSize:z.number().int().min(1).max(32).default(24)}).strict();
export async function POST(request:Request){
 try{
  const ctx=await auth();
  const {batchSize}=await read(request,indexSchema);
  const {data,error}=await ctx.db.from("ai_preferences").select("semantic_enabled")
   .eq("owner_id",ctx.user.id).maybeSingle();
  dbError(error,"Impossibile leggere le preferenze di ricerca");
  if(!data?.semantic_enabled)throw new ApiFailure(409,"Attiva prima la ricerca semantica locale");
  return json({...await indexNextKnowledgeBatch(null,batchSize),runtime:localEmbeddingRuntimeStatus()});
 }catch(error){return fail(error);}
}
