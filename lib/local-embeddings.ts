import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getLocalDataDirectory } from "./local-db";

export const LOCAL_EMBEDDING_MODEL_ID="Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const LOCAL_EMBEDDING_MODEL_REVISION="b9e20f0c6dd7e5f88c72259765011e6a3a9196bc";
export const LOCAL_EMBEDDING_INDEX_ID=`${LOCAL_EMBEDDING_MODEL_ID}@${LOCAL_EMBEDDING_MODEL_REVISION}`;
export const LOCAL_EMBEDDING_DIMENSIONS=384;

type Tensor={data:Float32Array;dims:number[]};
type Extractor=(texts:string|string[],options:{pooling:"mean";normalize:true})=>Promise<Tensor>;
type Runtime={pipeline:(task:"feature-extraction",model:string,options:Record<string,unknown>)=>Promise<Extractor>;env:{cacheDir:string|null;backends:{onnx:{wasm:{numThreads?:number}}}}};
let extractorPromise:Promise<Extractor>|null=null;
let state:"not_loaded"|"loading"|"ready"|"error"="not_loaded";

export function localEmbeddingRuntimeStatus(){return {state,model:LOCAL_EMBEDDING_MODEL_ID};}

async function extractor():Promise<Extractor>{
 if(extractorPromise)return extractorPromise;
 state="loading";
 extractorPromise=(async()=>{
  const runtime=await import("@huggingface/transformers") as unknown as Runtime;
  const cacheDir=join(getLocalDataDirectory(),"models","huggingface");
  mkdirSync(cacheDir,{recursive:true,mode:0o700});
  runtime.env.cacheDir=cacheDir;
  runtime.env.backends.onnx.wasm.numThreads=1;
  return runtime.pipeline("feature-extraction",LOCAL_EMBEDDING_MODEL_ID,{
   revision:LOCAL_EMBEDDING_MODEL_REVISION,dtype:"q8"
  });
 })().then(value=>{state="ready";return value;}).catch(error=>{
  state="error";extractorPromise=null;throw error;
 });
 return extractorPromise;
}

export async function embedLocalTexts(texts:string[]):Promise<number[][]>{
 if(!texts.length)return [];
 if(texts.length>32||texts.some(text=>!text.trim()||text.length>5000))
  throw new Error("Testi embeddings oltre i limiti consentiti");
 const run=await extractor();
 const output=await run(texts,{pooling:"mean",normalize:true});
 const [rows,dimensions]=output.dims;
 if(rows!==texts.length||dimensions!==LOCAL_EMBEDDING_DIMENSIONS||
    output.data.length!==rows*dimensions||![...output.data].every(Number.isFinite))
  throw new Error("Il modello locale ha restituito embeddings non validi");
 return Array.from({length:rows},(_,row)=>
  Array.from(output.data.slice(row*dimensions,(row+1)*dimensions))
 );
}
