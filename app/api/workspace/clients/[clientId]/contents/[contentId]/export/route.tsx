import { z } from "zod";
import { ImageResponse } from "next/og";
import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import { auth,requireClient,fail,ApiFailure } from "@/lib/http";
import { STATIC_FORMATS } from "@/lib/editorial-principles";
import { brandStyle,rgbFromHex } from "@/lib/brand";

export const runtime="nodejs";
export const maxDuration=30;
type Params={params:Promise<{clientId:string,contentId:string}>};
type Slide={headline?:string;body?:string;image_path?:string};
function supportedText(value:string){
 return value.replace(/[^\x20-\x7E\u00A0-\u00FF]/g," ").replace(/\s+/g," ").trim();
}
async function pdfExport(name:string,slides:Slide[],caption:string,clientId:string,brandName:string,palette:ReturnType<typeof brandStyle>,db:Awaited<ReturnType<typeof auth>>["db"]){
 const doc=await PDFDocument.create();
 const regular=await doc.embedFont(StandardFonts.Helvetica);
 const bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const {width:w,height:h}=STATIC_FORMATS.linkedin;
 const pages=slides.length?slides:[{headline:name,body:caption}];
 for(let i=0;i<pages.length;i++){
  const current=pages[i],page=doc.addPage([w,h]);
  page.drawRectangle({x:0,y:0,width:w,height:h,color:rgb(...rgbFromHex(palette.background))});
  if(current.image_path){
   if(!current.image_path.startsWith(clientId+"/") || current.image_path.includes(".."))throw new ApiFailure(403,"Risorsa fuori dal profilo");
   const {data:asset,error:assetError}=await db.storage.from("forgecy-assets").download(current.image_path);
   if(assetError||!asset)throw new ApiFailure(502,"Impossibile caricare l'immagine del documento");
   const embedded=await doc.embedPng(await asset.arrayBuffer());
   const scale=Math.max(w/embedded.width,h/embedded.height);
   page.drawImage(embedded,{x:(w-embedded.width*scale)/2,y:(h-embedded.height*scale)/2,width:embedded.width*scale,height:embedded.height*scale});
   page.drawRectangle({x:0,y:0,width:w,height:h,color:rgb(...rgbFromHex(palette.background)),opacity:.72});
  }
  page.drawText(supportedText(brandName).slice(0,65)+"  /  LINKEDIN",{x:120,y:960,size:25,font:bold,color:rgb(...rgbFromHex(palette.text))});
  const drawWrapped=(str:string,startY:number,size:number,font:typeof bold,maxLines:number)=>{
   const words=supportedText(str).split(/\s+/);
   const lines:string[]=[];let line="";
   for(const word of words){
    const candidate=line?line+" "+word:word;
    if(font.widthOfTextAtSize(candidate,size)>w-240 && line){lines.push(line);line=word;}else line=candidate;
   }
   if(line)lines.push(line);
   lines.slice(0,maxLines).forEach((s,j)=>page.drawText(s,{x:120,y:startY-j*size*1.26,size,font,color:rgb(...rgbFromHex(palette.text))}));
   return startY-Math.min(lines.length,maxLines)*size*1.26;
  };
  const end=drawWrapped(current.headline||name,820,82,bold,5);
  drawWrapped(current.body||"",Math.min(end-48,470),36,regular,8);
  page.drawText("Pagina "+(i+1)+" / "+pages.length,{x:120,y:65,size:23,font:regular,color:rgb(...rgbFromHex(palette.text))});
 }
 const bytes=await doc.save();
 return new Response(new Uint8Array(bytes),{
  headers:{"Content-Type":"application/pdf","Content-Disposition":"attachment; filename=forgecy-linkedin.pdf","Cache-Control":"no-store"}
 });
}
export async function GET(request:Request,{params}:Params){
 try{
  const {clientId,contentId}=await params,ctx=await auth();
  const client=await requireClient(ctx,clientId);
  if(!z.uuid().safeParse(contentId).success)throw new ApiFailure(400,"ID contenuto non valido");
  const {data,error}=await ctx.db.from("contents").select("channel,format,title,caption,slides,status").eq("client_id",clientId).eq("id",contentId).maybeSingle();
  if(error||!data)throw new ApiFailure(404,"Contenuto non trovato");
  if(data.status==="stale")throw new ApiFailure(409,"Questo contenuto è obsoleto: aggiornalo prima di esportare");
  const url=new URL(request.url);
  const format=url.searchParams.get("format")||"png";
  const slides=Array.isArray(data.slides)?(data.slides as Slide[]):[];
  if(format==="pdf"){
    if(data.channel!=="linkedin")throw new ApiFailure(400,"Il PDF è destinato alle varianti LinkedIn");
    return await pdfExport(data.title,slides,data.caption,clientId,client.name,brandStyle(client.profile),ctx.db);
  }
  if(format==="txt"){
   return new Response(data.caption,{headers:{"Content-Type":"text/plain; charset=utf-8","Content-Disposition":"attachment; filename=forgecy-post.txt"}});
  }
  if(format!=="png")throw new ApiFailure(400,"Formato non supportato");
  const idx=Math.max(0,Math.min(slides.length-1,Number(url.searchParams.get("slide")||0)));
  if(!Number.isInteger(idx)||!slides[idx])throw new ApiFailure(400,"Pagina non disponibile");
  const slide=slides[idx];
  let signedImage:string|null=null;
  if(slide.image_path){
   if(!slide.image_path.startsWith(clientId+"/")||slide.image_path.includes(".."))throw new ApiFailure(403,"Risorsa non autorizzata");
   const {data:image,error:imageError}=await ctx.db.storage.from("forgecy-assets").createSignedUrl(slide.image_path,60);
   if(imageError||!image)throw new ApiFailure(502,"Immagine di pagina non disponibile");
   signedImage=image.signedUrl;
  }
  const palette=brandStyle(client.profile);
  const dims=data.channel==="linkedin"?STATIC_FORMATS.linkedin:STATIC_FORMATS.instagram;
  const pad=data.channel==="linkedin"?124:82;
  return new ImageResponse(
   <div style={{width:"100%",height:"100%",display:"flex",position:"relative",backgroundColor:palette.background,color:palette.text,fontFamily:"sans-serif"}}>
    {signedImage&&<img alt="" src={signedImage} width={dims.width} height={dims.height} style={{position:"absolute",width:"100%",height:"100%",objectFit:"cover"}}/>}
    {signedImage&&<div style={{position:"absolute",width:"100%",height:"100%",backgroundColor:palette.background,opacity:.72,display:"flex"}}/>}
    <div style={{display:"flex",position:"relative",width:"100%",height:"100%",flexDirection:"column",justifyContent:"space-between",padding:pad}}>
    <div style={{display:"flex",fontSize:23,fontWeight:800,letterSpacing:3}}>{client.name.slice(0,50)}  /  {data.channel.toUpperCase()}</div>
    <div style={{display:"flex",flexDirection:"column"}}>
     <div style={{fontSize:slide.headline && slide.headline.length>75?48:72,lineHeight:1.12,fontWeight:800,marginBottom:48}}>{slide.headline||data.title}</div>
     <div style={{fontSize:37,lineHeight:1.5}}>{slide.body||""}</div>
    </div>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:24,fontWeight:700}}><span>{data.title.slice(0,45)}</span><span>{idx+1} / {slides.length}</span></div>
    </div>
   </div>,
   {width:dims.width,height:dims.height,headers:{"Content-Disposition":"attachment; filename=forgecy-slide-"+(idx+1)+".png","Cache-Control":"no-store"}}
  );
 }catch(e){return fail(e)}
}
