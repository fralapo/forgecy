import { assertSafeDocument, DocumentSafetyError } from "./document-safety";
import { createHash } from "node:crypto";
import { parseLocalCatalogProducts, parsePositionedNativeCatalogRows, normalizeCatalogName, looksLikeCatalog, type CatalogProduct } from "./catalog-import";
import type { DocumentImage } from "./document-image";
import { createPdfParser, getPositionedPdfText } from "./pdf-runtime";
/**
 * Bound client-upload text extraction. Original binary always remains in private
 * Local private storage; extracted text is separate, untrusted evidence.
 */
export type Extraction={status:"ready"|"pending"|"error";body:string;error:string|null};
export type DocumentExtraction={extraction:Extraction;pageCount:number|null;pagesProcessed?:number|null;textTruncated?:boolean;nativeImages?:DocumentImage[];nativeCatalogProducts?:CatalogProduct[]};
export const MAX_EXTRACT_CHARS=80000;
const MIN_NATIVE_PDF_TEXT_CHARS=80;
export const MAX_NATIVE_PDF_PAGES=500;
const MAX_NATIVE_PDF_IMAGES=8;
const MAX_NATIVE_PDF_IMAGE_BYTES=10_000_000;
const MAX_NATIVE_PDF_IMAGE_PIXELS=12_000_000;
function clean(value:string):string{
 return value.replace(/\u0000/g,"").replace(/\r\n?/g,"\n").trim().slice(0,MAX_EXTRACT_CHARS);
}
export async function extractNativeCatalogImages(parser:Awaited<ReturnType<typeof createPdfParser>>,pages:Array<{num:number;text:string}>,title:string,body:string):Promise<DocumentImage[]>{
 const products=parseLocalCatalogProducts(title,body);
 if(!products.length)return [];
 const candidates=pages.map(page=>({page:page.num,names:[...new Set(products
  .filter(product=>normalizeCatalogName(page.text).includes(normalizeCatalogName(product.name)))
  .map(product=>product.name))]})).filter(page=>page.page>0&&page.names.length)
  .sort((a,b)=>b.names.length-a.names.length||a.page-b.page);
 const found:DocumentImage[]=[];const hashes=new Set<string>();let totalBytes=0;
 for(const candidate of candidates){
  if(found.length>=MAX_NATIVE_PDF_IMAGES)break;
  let result;
  try{result=await parser.getImage({partial:[candidate.page],imageBuffer:true,imageDataUrl:false,imageThreshold:100});}
  catch{continue;}
  const pageImages=result.pages.find(page=>page.pageNumber===candidate.page)?.images||[];
  // Keep only pages whose image objects and locally verified product headings map one-to-one.
  if(!pageImages.length||pageImages.length!==candidate.names.length||pageImages.length>MAX_NATIVE_PDF_IMAGES-found.length)continue;
  const prepared=pageImages.map(image=>({image,bytes:Buffer.from(image.data)}));
  if(prepared.some(({image,bytes})=>image.width*image.height>MAX_NATIVE_PDF_IMAGE_PIXELS||!bytes.length||bytes.length>5_000_000||
   bytes[0]!==0x89||bytes[1]!==0x50||bytes[2]!==0x4e||bytes[3]!==0x47))continue;
  const pageTotal=prepared.reduce((sum,item)=>sum+item.bytes.length,0);
  if(totalBytes+pageTotal>MAX_NATIVE_PDF_IMAGE_BYTES)continue;
  for(const {bytes} of prepared){
   const sha256=createHash("sha256").update(bytes).digest("hex");
   if(hashes.has(sha256))continue;
   hashes.add(sha256);totalBytes+=bytes.length;
   found.push({dataUrl:`data:image/png;base64,${bytes.toString("base64")}`,mime:"image/png",sha256,
    origin:"native-pdf",pageNumber:candidate.page,candidateProductNames:candidate.names});
  }
 }
 return found;
}
export async function extractDocumentWithMetadata(bytes:Uint8Array,mime:string,name:string):Promise<DocumentExtraction>{
 const ext=name.toLowerCase().split(".").pop();
 try {
  assertSafeDocument(bytes,mime,name);
  if(["txt","md","csv"].includes(ext||"")&&mime.startsWith("text/")){
   const decoded=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
   return {extraction:{status:decoded.trim()?"ready":"error",body:clean(decoded),
    error:decoded.trim()?null:"File di testo vuoto"},pageCount:null,textTruncated:decoded.length>MAX_EXTRACT_CHARS};
  }
  if(ext==="pdf"&&mime==="application/pdf"){
    if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")
    return {extraction:{status:"error",body:"",error:"File PDF non valido"},pageCount:null};
   const parser=await createPdfParser(bytes);
   try {
    const info=await parser.getInfo({parsePageInfo:false});
    const pageCount=Number.isInteger(info.total)&&info.total>0?info.total:null;
    // Process native text in bounded ranges to cover long PDFs without one unbounded parser call.
    const pages:Array<{num:number;text:string}> = [];
    let textLength=0;
    const lastPage=Math.min(pageCount||MAX_NATIVE_PDF_PAGES,MAX_NATIVE_PDF_PAGES);
    for(let first=1;first<=lastPage;first+=40){
     const last=Math.min(first+39,lastPage);
     const batch=await parser.getText({first,last,pageJoiner:""});
     for(const page of batch.pages||[]){
      if(textLength>=MAX_EXTRACT_CHARS)break;
      const marker=`\n[Pagina PDF ${page.num}]\n`;
      const remaining=MAX_EXTRACT_CHARS-textLength-marker.length;
      const pageText=page.text.slice(0,Math.max(0,remaining));
      pages.push({...page,text:pageText});
      textLength+=marker.length+pageText.length;
     }
     if(textLength>=MAX_EXTRACT_CHARS)break;
    }
    const pagesProcessed=pages.length;
    const body=clean(pages.map(page=>`[Pagina PDF ${page.num}]\n${page.text}`).join("\n\n"));
    const textTruncated=(pageCount!==null&&pageCount>pagesProcessed)||textLength>=MAX_EXTRACT_CHARS;
    if(body.length<MIN_NATIVE_PDF_TEXT_CHARS)return {extraction:{status:"error",body:"",error:"PDF senza testo nativo sufficiente: serve OCR o una trascrizione"},pageCount,pagesProcessed,textTruncated};
    const nativeImages=await extractNativeCatalogImages(parser,pages,name,body);
    const nativeCatalogProducts:CatalogProduct[]=[];
    if(looksLikeCatalog(name,body))for(const page of pages){
     if(nativeCatalogProducts.length>=200)break;
     try{nativeCatalogProducts.push(...parsePositionedNativeCatalogRows(name,await getPositionedPdfText(parser,page.num)));}
     catch(error){console.warn("[document-extract] positioned catalog extraction skipped for page",page.num,error instanceof Error?error.message:"unknown");}
    }
    return {extraction:{status:"ready",body,error:null},pageCount,pagesProcessed,textTruncated,...(nativeImages.length?{nativeImages}:{}),...(nativeCatalogProducts.length?{nativeCatalogProducts:nativeCatalogProducts.slice(0,200)}:{})};
   }finally{await parser.destroy();}
  }
  if(ext==="docx"&&mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
   if(bytes[0]!==0x50||bytes[1]!==0x4b)
    return {extraction:{status:"error",body:"",error:"File DOCX non valido"},pageCount:null};
   const mammoth=await import("mammoth");
   const extracted=await mammoth.extractRawText({buffer:Buffer.from(bytes)});
   const body=clean(extracted.value||"");
   return {extraction:body.length>5?{status:"ready",body,error:null}:
    {status:"error",body:"",error:"Il documento Word non contiene testo leggibile"},pageCount:null,textTruncated:extracted.value.length>MAX_EXTRACT_CHARS};
  }
  if(["png","jpg","jpeg","webp"].includes(ext||"")&&mime.startsWith("image/"))
   return {extraction:{status:"pending",body:"",error:"Immagine archiviata: estrazione OCR non ancora disponibile"},pageCount:null};
  return {extraction:{status:"error",body:"",error:"Formato non supportato o estensione e MIME non corrispondenti"},pageCount:null};
 }catch(error){
  if(error instanceof DocumentSafetyError)
   return {extraction:{status:"error",body:"",error:error.message},pageCount:null};
  console.error("[document-extract]",error instanceof Error?error.message:"unknown");
  return {extraction:{status:"error",body:"",error:"Estrazione non riuscita: prova un PDF testuale o DOCX valido"},pageCount:null};
 }
}

export async function extractDocument(bytes:Uint8Array,mime:string,name:string):Promise<Extraction>{
 return (await extractDocumentWithMetadata(bytes,mime,name)).extraction;
}
