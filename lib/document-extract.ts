import { assertSafeDocument, DocumentSafetyError } from "./document-safety";
/**
 * Bound client-upload text extraction. Original binary always remains in private
 * Local private storage; extracted text is separate, untrusted evidence.
 */
export type Extraction={status:"ready"|"pending"|"error";body:string;error:string|null};
export const MAX_EXTRACT_CHARS=80000;
function clean(value:string):string{
 return value.replace(/\u0000/g,"").replace(/\r\n?/g,"\n").trim().slice(0,MAX_EXTRACT_CHARS);
}
export async function extractDocument(bytes:Uint8Array,mime:string,name:string):Promise<Extraction>{
 const ext=name.toLowerCase().split(".").pop();
 try {
  assertSafeDocument(bytes,mime,name);
  if(["txt","md","csv"].includes(ext||"")&&mime.startsWith("text/")){
   const decoded=new TextDecoder("utf-8",{fatal:false}).decode(bytes);
   return {status:decoded.trim()?"ready":"error",body:clean(decoded),
    error:decoded.trim()?null:"File di testo vuoto"};
  }
  if(ext==="pdf"&&mime==="application/pdf"){
   if(new TextDecoder().decode(bytes.subarray(0,5))!=="%PDF-")
    return {status:"error",body:"",error:"File PDF non valido"};
   await import("pdf-parse/worker");
   const {PDFParse}=await import("pdf-parse");
   const parser=new PDFParse({data:Uint8Array.from(bytes)});
   try {
    // Extract a bounded prefix; scanned PDFs need explicit OCR (not silently guessed).
    const text=await parser.getText({first:40,pageJoiner:""});
    const body=clean(text.text||"");
    return body.length>20?{status:"ready",body,error:null}:
     {status:"error",body:"",error:"PDF senza testo leggibile: serve OCR o una trascrizione"};
   }finally{await parser.destroy();}
  }
  if(ext==="docx"&&mime==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
   if(bytes[0]!==0x50||bytes[1]!==0x4b)
    return {status:"error",body:"",error:"File DOCX non valido"};
   const mammoth=await import("mammoth");
   const extracted=await mammoth.extractRawText({buffer:Buffer.from(bytes)});
   const body=clean(extracted.value||"");
   return body.length>5?{status:"ready",body,error:null}:
    {status:"error",body:"",error:"Il documento Word non contiene testo leggibile"};
  }
  if(["png","jpg","jpeg","webp"].includes(ext||"")&&mime.startsWith("image/"))
   return {status:"pending",body:"",error:"Immagine archiviata: estrazione OCR non ancora disponibile"};
  return {status:"error",body:"",error:"Formato non supportato o estensione e MIME non corrispondenti"};
 }catch(error){
  if(error instanceof DocumentSafetyError)
   return {status:"error",body:"",error:error.message};
  console.error("[document-extract]",error instanceof Error?error.message:"unknown");
  return {status:"error",body:"",error:"Estrazione non riuscita: prova un PDF testuale o DOCX valido"};
 }
}
