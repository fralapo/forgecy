import { z } from "zod";
import { auth,requireClient,read,fail,json,ApiFailure,dbError,audit } from "@/lib/http";
export const runtime="nodejs";
export const maxDuration=120;

export async function POST(request:Request,{params}:{params:Promise<{clientId:string,contentId:string}>}){
 try{
  const {clientId,contentId}=await params,ctx=await auth();
  await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(contentId).success)throw new ApiFailure(400,"ID contenuto non valido");
  const input=await read(request,z.object({
   slideIndex:z.number().int().min(0).max(19),
   prompt:z.string().trim().min(12).max(1600)
  }));
  const {data:content,error}=await ctx.db.from("contents").select("id,slides,revision").eq("id",contentId).eq("client_id",clientId).maybeSingle();
  dbError(error);if(!content)throw new ApiFailure(404,"Contenuto non trovato");
  const slides=Array.isArray(content.slides)?content.slides:[];
  if(input.slideIndex>=slides.length)throw new ApiFailure(400,"Slide inesistente");
  const key=process.env.OPENAI_API_KEY;
  if(!key)throw new ApiFailure(503,"OPENAI_API_KEY non configurata: immagini AI disabilitate");
  const response=await fetch("https://api.openai.com/v1/images/generations",{
   method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
   body:JSON.stringify({
    model:process.env.OPENAI_IMAGE_MODEL||"gpt-image-1",
    prompt:"Professional editorial image for a static brand carousel. "+input.prompt+
      "\nAvoid any invented logos, text, pricing, trademarks or identifiable real people.",
    size:"1024x1536",quality:"medium",n:1
   }),
   signal:AbortSignal.timeout(85000),cache:"no-store"
  });
  if(!response.ok) {
   console.error("[openai image]",response.status);
   throw new ApiFailure(502,"Generazione immagine non riuscita: HTTP "+response.status);
  }
  const payload=await response.json() as {data?:Array<{b64_json?:string}>};
  const encoded=payload.data?.[0]?.b64_json;
  if(!encoded)throw new ApiFailure(502,"Nessuna immagine ricevuta");
  const binary=Buffer.from(encoded,"base64");
  if(binary.length>15_000_000)throw new ApiFailure(413,"Immagine troppo grande");
  const path=clientId+"/"+contentId+"/"+crypto.randomUUID()+".png";
  const uploaded=await ctx.db.storage.from("forgecy-assets").upload(path,binary,{contentType:"image/png",upsert:false});
  dbError(uploaded.error,"Immagine generata ma archiviazione non riuscita");
  const updatedSlides=slides.map((s,i)=>i===input.slideIndex?{...s,image_path:path,visual_prompt:input.prompt}:s);
  const saved=await ctx.db.from("contents").update({slides:updatedSlides}).eq("id",contentId).eq("client_id",clientId).eq("revision",content.revision).select("id,revision,slides").maybeSingle();
  if(saved.error||!saved.data){
   await ctx.db.storage.from("forgecy-assets").remove([path]);
   throw new ApiFailure(409,"Il contenuto è cambiato durante la generazione. Riprova.");
  }
  await audit(ctx,clientId,"image_generated",contentId,{slide_index:input.slideIndex});
  return json({content:saved.data,path});
 }catch(e){return fail(e)}
}
