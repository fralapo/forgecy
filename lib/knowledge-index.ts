import { workerDb } from "./worker-db";
import { embedLocalTexts, LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL_ID } from "./local-embeddings";

export type StoredKnowledgeHit={source_id:string;source_title:string;source_url:string|null;chunk_ordinal:number;excerpt:string;relevance:number;section_title?:string};

function toBlob(vector:number[]){
 const blob=Buffer.allocUnsafe(vector.length*4);
 vector.forEach((value,index)=>blob.writeFloatLE(value,index*4));
 return blob;
}

export function knowledgeEmbeddingCounts(clientId?:string|null,modelId=LOCAL_EMBEDDING_MODEL_ID){
 const db=workerDb().connection;
 const scope=clientId?"AND c.client_id=?":"";
 const args=clientId?[clientId]:[];
 const total=db.prepare(`SELECT count(*) count FROM source_chunks c JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id WHERE s.status='ready' ${scope}`).get(...args) as {count:number};
 const indexed=db.prepare(`SELECT count(*) count FROM source_chunk_embeddings e JOIN source_chunks c ON c.id=e.chunk_id JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id WHERE s.status='ready' AND e.model_id=? AND e.dimensions=? ${scope}`).get(modelId,LOCAL_EMBEDDING_DIMENSIONS,...args) as {count:number};
 return {total:Number(total.count),indexed:Number(indexed.count),modelId};
}

export async function indexNextKnowledgeBatch(clientId:string|null=null,batchSize=24){
 const size=Math.min(32,Math.max(1,Math.floor(batchSize)));
 const counts=knowledgeEmbeddingCounts(clientId);
 const db=workerDb().connection;
 const scope=clientId?"AND c.client_id=?":"";
 const pending=db.prepare(`SELECT c.id,c.body FROM source_chunks c
   JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id
   WHERE s.status='ready' ${scope} AND NOT EXISTS(
     SELECT 1 FROM source_chunk_embeddings e WHERE e.chunk_id=c.id AND e.model_id=? AND e.dimensions=?)
   ORDER BY c.id LIMIT ?`).all(...(clientId?[clientId,LOCAL_EMBEDDING_MODEL_ID,LOCAL_EMBEDDING_DIMENSIONS,size]:[LOCAL_EMBEDDING_MODEL_ID,LOCAL_EMBEDDING_DIMENSIONS,size])) as Array<{id:number;body:string}>;
 if(!pending.length)return {...counts,indexedNow:0,remaining:Math.max(0,counts.total-counts.indexed),complete:true};
 const vectors=await embedLocalTexts(pending.map(chunk=>chunk.body));
 const insert=db.prepare(`INSERT INTO source_chunk_embeddings(chunk_id,model_id,dimensions,vector,created_at)
   VALUES(?,?,?,?,?) ON CONFLICT(chunk_id,model_id) DO UPDATE SET dimensions=excluded.dimensions,vector=excluded.vector,created_at=excluded.created_at`);
 const now=new Date().toISOString();
 db.transaction(()=>pending.forEach((chunk,index)=>insert.run(chunk.id,LOCAL_EMBEDDING_MODEL_ID,LOCAL_EMBEDDING_DIMENSIONS,toBlob(vectors[index]),now)))();
 const updated=knowledgeEmbeddingCounts(clientId);
 const remaining=Math.max(0,updated.total-updated.indexed);
 return {...updated,indexedNow:pending.length,remaining,complete:remaining===0};
}

export async function searchSemanticKnowledge(clientId:string,query:string,limit=12):Promise<StoredKnowledgeHit[]>{
 const [vector]=await embedLocalTexts([query]);
 if(vector.length!==LOCAL_EMBEDDING_DIMENSIONS)throw new Error("Dimensione query embedding non supportata");
 const db=workerDb().connection;
 const rows=db.prepare(`SELECT c.id chunk_id,c.ordinal chunk_ordinal,c.body excerpt,c.section_title,
   s.id source_id,s.title source_title,s.url source_url,e.vector,e.dimensions
   FROM source_chunk_embeddings e JOIN source_chunks c ON c.id=e.chunk_id
   JOIN sources s ON s.id=c.source_id AND s.client_id=c.client_id
   WHERE c.client_id=? AND s.status='ready' AND e.model_id=? AND e.dimensions=?`).all(
    clientId,LOCAL_EMBEDDING_MODEL_ID,LOCAL_EMBEDDING_DIMENSIONS
   ) as Array<{chunk_id:number;chunk_ordinal:number;excerpt:string;section_title:string;source_id:string;source_title:string;source_url:string|null;vector:Buffer;dimensions:number}>;
 const mapped:(StoredKnowledgeHit|null)[]=rows.map(row=>{
  const data=row.vector;
  if(data.byteLength!==row.dimensions*4)return null;
  let relevance=0;
  for(let i=0;i<vector.length;i++)relevance+=vector[i]*data.readFloatLE(i*4);
  return {source_id:row.source_id,source_title:row.source_title,source_url:row.source_url,
   chunk_ordinal:row.chunk_ordinal,excerpt:row.excerpt,section_title:row.section_title,
   relevance:Math.max(-1,Math.min(1,relevance))};
 });
 return mapped.filter((hit):hit is StoredKnowledgeHit=>hit!==null)
  .sort((a,b)=>b.relevance-a.relevance||a.chunk_ordinal-b.chunk_ordinal)
  .slice(0,Math.min(50,Math.max(1,limit)));
}
