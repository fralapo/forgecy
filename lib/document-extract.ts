import { assertSafeDocument, DocumentSafetyError } from "./document-safety";
/**
 * Bound client-upload text extraction. Original binary always remains in private
 * Local private storage; extracted text is separate, untrusted evidence.
 */
export type Extraction={status:"ready"|"pending"|"error";body:string;error:string|null};
export type DocumentExtraction={extraction:Extraction;pageCount:number|null};
export const MAX_EXTRACT_CHARS=80000;
const MIN_NATIVE_PDF_TEXT_CHARS=80;
function clean(value:string):string{
 return value.replace(/\u0000/g,"").replace(/\r\n?/g,"\n").trim().slice(0,MAX_EXTRACT_CHARS);
}
export async function extractDocumentWithMetadata(bytes:Uint8Array,mime:string,name:string):Promise<DocumentExtraction>{
 const ext=name.toLowerCase().split(".").pop();
 try {
  assertSafeDocument(bytes,mime,name);
  if(["txt","md","csv"].includes(ext||"")&&mime.startsWith("text/")){
   const decoded=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
   return {extraction:{status:decoded.trim()?"ready":"error",body:clean(decoded),
    error:decoded.trim()?null:"File di testo vuoto"},pageCount:null};
  }
  if(ext==="pdf"&&mime==="application/pdf"){
   if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")
    return {extraction:{status:"error",body:"",error:"File PDF non valido"},pageCount:null};
   await import("pdf-parse/worker");
   const {PDFParse}=await import("pdf-parse");
   const parser=new PDFParse({data:Uint8Array.from(bytes)});
   try {
    const info=await parser.getInfo({parsePageInfo:false});
    const pageCount=Number.isInteger(info.total)&&info.total>0?info.total:null;
    // Extract a bounded prefix; scanned PDFs need explicit OCR (not silently guessed).
    const text=await parser.getText({first:40,pageJoiner:""});
    const body=clean(text.text||"");
    return {extraction:body.length>=MIN_NATIVE_PDF_TEXT_CHARS?{status:"ready",body,error:null}:
     {status:"error",body:"",error:"PDF senza testo nativo sufficiente: serve OCR o una trascrizione"},pageCount};
   }finally{await parser.destroy();}
  }
  if(ext==="docx"&&mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
   if(bytes[0]!==0x50||bytes[1]!==0x4b)
    return {extraction:{status:"error",body:"",error:"File DOCX non valido"},pageCount:null};
   const mammoth=await import("mammoth");
   const extracted=await mammoth.extractRawText({buffer:Buffer.from(bytes)});
   const body=clean(extracted.value||"");
   return {extraction:body.length>5?{status:"ready",body,error:null}:
    {status:"error",body:"",error:"Il documento Word non contiene testo leggibile"},pageCount:null};
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
