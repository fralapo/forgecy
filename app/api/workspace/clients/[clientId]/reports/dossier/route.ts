import {auth,requireClient,fail,ApiFailure,dbError} from "@/lib/http";
import {renderDossierMarkdown,type DossierReport} from "@/lib/agency-reports";
export const runtime="nodejs";
type P={params:Promise<{clientId:string}>};
export async function GET(_request:Request,{params}:P){
 try{
  const clientId=(await params).clientId,ctx=await auth();
  const client=await requireClient(ctx,clientId);
  const [d,src,offers,signals,snapshots]=await Promise.all([
   ctx.db.from("dossiers").select("version,summary,findings,status,knowledge_revision")
    .eq("client_id",clientId).order("version",{ascending:false}).limit(1).maybeSingle(),
   ctx.db.from("sources").select("id,title,kind,url").eq("client_id",clientId).limit(300),
   ctx.db.from("offers").select("id,name").eq("client_id",clientId).limit(100),
   ctx.db.from("community_signals").select("id,topic").eq("client_id",clientId).limit(100),
   ctx.db.from("social_snapshots").select("id,period").eq("client_id",clientId).limit(60)
  ]);
  for(const result of [d,src,offers,signals,snapshots])dbError(result.error);
  if(!d.data)throw new ApiFailure(404,"Non esiste ancora un dossier da esportare");
  const refs=[
   ...(src.data||[]),
   ...(offers.data||[]).map(x=>({id:x.id,title:x.name})),
   ...(signals.data||[]).map(x=>({id:x.id,title:x.topic})),
   ...(snapshots.data||[]).map(x=>({id:x.id,title:"Instagram "+x.period}))
  ];
  const content=renderDossierMarkdown(client.name,d.data as DossierReport,refs);
  return new Response(content,{headers:{
   "Content-Type":"text/markdown; charset=utf-8",
   "Content-Disposition":"attachment; filename=forgecy-dossier.md",
   "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"
  }});
 }catch(e){return fail(e);}
}
