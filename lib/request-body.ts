import {ApiFailure} from "./http";

/** Read multipart bodies with a hard size bound before invoking the form parser. */
export async function readMultipartForm(request:Request,maxBytes=11_000_000):Promise<FormData>{
  const mime=request.headers.get("content-type")||"";
  if(!/^multipart\/form-data\s*;\s*boundary=(?:"[^"]{1,100}"|[^\s;]{1,100})(?:\s*;.*)?$/i.test(mime))
    throw new ApiFailure(415,"È richiesto un modulo multipart/form-data con boundary");
  const declaredRaw=request.headers.get("content-length");
  if(declaredRaw!==null){
    const declared=Number(declaredRaw);
    if(!Number.isSafeInteger(declared)||declared<0)
      throw new ApiFailure(400,"Content-Length non valido");
    if(declared>maxBytes)
      throw new ApiFailure(413,"Richiesta multipart troppo grande");
  }
  if(!request.body)throw new ApiFailure(400,"Modulo multipart vuoto");
  const reader=request.body.getReader();
  let size=0;
  const chunks:Uint8Array[]=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){
        await reader.cancel().catch(()=>undefined);
        throw new ApiFailure(413,"Richiesta multipart troppo grande");
      }
      chunks.push(value);
    }
  }catch(error){
    if(error instanceof ApiFailure)throw error;
    throw new ApiFailure(400,"Caricamento multipart interrotto");
  }finally{reader.releaseLock();}
  try{
    const data=new Uint8Array(size);
    let cursor=0;
    for(const chunk of chunks){data.set(chunk,cursor);cursor+=chunk.byteLength;}
    const bounded=new Request(request.url,{
      method:"POST",
      headers:{"content-type":mime},
      body:data as unknown as BodyInit
    });
    return await bounded.formData();
  }catch{
    throw new ApiFailure(400,"Il modulo multipart non è valido");
  }
}
