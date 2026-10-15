import assert from "node:assert/strict";
import {test} from "node:test";
import {z} from "zod";
import {modelJson,modelStructuredJson} from "../../lib/ai";

test("JSON extraction options disable reasoning and cap latency while preserving schema validation",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="test-server-only-token";
 const captured:{outgoing?:Record<string,unknown>}={};
 globalThis.fetch=async(_url,init)=>{
  captured.outgoing=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"ok"}'}}]}),{status:200});
 };
 try{
  const result=await modelJson("Sistema","Fonte",z.object({summary:z.string()}),{maxTokens:6200,timeoutMs:45000,temperature:0.1,reasoningEnabled:false});
  assert.deepEqual(result,{summary:"ok"});
  assert.equal(captured.outgoing?.max_tokens,6200);
  assert.deepEqual(captured.outgoing?.reasoning,{enabled:false});
  assert.equal(captured.outgoing?.temperature,0.1);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;
 }
});

test("empty JSON responses distinguish provider token truncation",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="test-server-only-token";
 globalThis.fetch=async()=>new Response(JSON.stringify({
  choices:[{finish_reason:"length",message:{content:null,reasoning:"internal reasoning"}}],
  usage:{completion_tokens:3000}
 }),{status:200});
 try{
  await assert.rejects(()=>modelJson("Sistema","Fonte",z.object({summary:z.string()})),/interrotta dal limite di token/);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;
 }
});

test("dossier inference requests server-only structured OpenRouter output",async()=>{
  const oldKey=process.env.OPENROUTER_API_KEY;
  const oldFetch=globalThis.fetch;
  process.env.OPENROUTER_API_KEY="test-server-only-token";
  let outgoing:Record<string,unknown>|null=null;
  globalThis.fetch=async (_url,init)=>{
    assert.equal(String(_url),"https://openrouter.ai/api/v1/chat/completions");
    outgoing=JSON.parse(String(init?.body));
    const headers=new Headers(init?.headers);
    assert.equal(headers.get("authorization"),"Bearer test-server-only-token");
    return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Un dossier test con prove.","findings":[]}'}}]}),
      {status:200,headers:{"Content-Type":"application/json"}});
  };
  try {
    const schema=z.object({
      summary:z.string().min(10),
      findings:z.array(z.object({claim:z.string()}))
    });
    const result=await modelStructuredJson("Sistema","Fonte test",schema,"forgecy_dossier",6200,async()=>process.env.OPENROUTER_API_KEY||null);
    assert.equal(result.findings.length,0);
    const request=outgoing as unknown as {
      response_format:{type:string;json_schema:{strict:boolean;schema:{type:string}}};
      provider:{require_parameters:boolean};max_completion_tokens:number;reasoning_effort:string
    };
    assert.equal(request.response_format.type,"json_schema");
    assert.equal(request.response_format.json_schema.strict,true);
    assert.equal(request.response_format.json_schema.schema.type,"object");
    assert.equal(request.provider.require_parameters,true);
    assert.equal(request.max_completion_tokens,6200);
    assert.equal(request.reasoning_effort,"low");
  } finally {
    globalThis.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY=oldKey;
  }
});

test("strict JSON Schema rejection falls back once to validated JSON-object mode",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="test-server-only-token";
 const requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  if(requests.length===1)return new Response('{"error":{"message":"unsupported strict schema"}}',{status:400});
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Valido con fallback"}'}}]}),{status:200});
 };
 try{
  const result=await modelStructuredJson("Sistema","Fonte",z.object({summary:z.string()}),"forgecy_dossier",6200,async()=>"test-server-only-token");
  assert.deepEqual(result,{summary:"Valido con fallback"});
  assert.equal(requests.length,2);
  assert.equal((requests[0].response_format as {type:string}).type,"json_schema");
  assert.equal((requests[1].response_format as {type:string}).type,"json_object");
  assert.deepEqual(requests[1].reasoning,{enabled:false});
  assert.equal(requests[1].max_tokens,6200);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;
 }
});

test("empty strict-schema responses retry once in validated JSON-object mode",async()=>{
 const oldFetch=globalThis.fetch;
 const requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  if(requests.length===1)return new Response(JSON.stringify({choices:[{message:{content:""}}]}),{status:200});
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Dossier recuperato"}'}}]}),{status:200});
 };
 try{
  const result=await modelStructuredJson("Sistema","Fonte",z.object({summary:z.string().min(10)}),"forgecy_dossier",6200,async()=>"test-server-only-token");
  assert.deepEqual(result,{summary:"Dossier recuperato"});
  assert.equal(requests.length,2);
  assert.equal((requests[0].response_format as {type:string}).type,"json_schema");
  assert.equal((requests[1].response_format as {type:string}).type,"json_object");
 }finally{globalThis.fetch=oldFetch;}
});

test("invalid strict-schema responses retry once and still enforce Zod validation",async()=>{
 const oldFetch=globalThis.fetch;
 const requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  if(requests.length===1)return new Response(JSON.stringify({choices:[{message:{content:'{"summary":3}'}}]}),{status:200});
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Schema verificato"}'}}]}),{status:200});
 };
 try{
  const result=await modelStructuredJson("Sistema","Fonte",z.object({summary:z.string().min(10)}),"forgecy_dossier",6200,async()=>"test-server-only-token");
  assert.deepEqual(result,{summary:"Schema verificato"});
  assert.equal(requests.length,2);
  assert.equal((requests[1].response_format as {type:string}).type,"json_object");
 }finally{globalThis.fetch=oldFetch;}
});

test("structured JSON fallback repairs schema errors once and validates the corrected result",async()=>{
 const oldFetch=globalThis.fetch;
 const requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body)) as Record<string,unknown>;
  requests.push(request);
  const format=request.response_format as {type:string};
  if(format.type==="json_schema")return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Dossier completo","findings":[]}'}}]}),{status:200});
  const messages=request.messages as Array<{role:string;content:string}>;
  if(messages[0].content.includes("non rispettava lo schema"))
   return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Dossier completo","findings":[{"claim":"Fatto supportato"}]}'}}]}),{status:200});
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"Dossier completo","findings":[]}'}}]}),{status:200});
 };
 try{
  const schema=z.object({summary:z.string().min(10),findings:z.array(z.object({claim:z.string()})).min(1)});
  const result=await modelStructuredJson("Sistema","Fonte",schema,"forgecy_dossier",6200,async()=>"test-server-only-token");
  assert.equal(result.findings.length,1);
  assert.equal(requests.length,3);
  const repairMessages=requests[2].messages as Array<{role:string;content:string}>;
  assert.match(repairMessages[0].content,/findings/);
  assert.deepEqual(requests[1].reasoning,{enabled:false});
  assert.deepEqual(requests[2].reasoning,{enabled:false});
  assert.deepEqual(result,{summary:"Dossier completo",findings:[{claim:"Fatto supportato"}]});
 }finally{globalThis.fetch=oldFetch;}
});

test("catalog extraction can disable reasoning and use a bounded timeout with strict JSON schema",async()=>{
 const oldFetch=globalThis.fetch;
 let outgoing:Record<string,unknown>|null=null;
 globalThis.fetch=async(_url,init)=>{
  outgoing=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({choices:[{message:{content:'{"summary":"ok"}'}}]}),{status:200});
 };
 try{
  const result=await modelStructuredJson("Sistema","Fonte",z.object({summary:z.string()}),"catalog_extraction",6200,async()=>"test-key",false,45000);
  assert.deepEqual(result,{summary:"ok"});
  const request=outgoing as unknown as Record<string,unknown>;
  assert.deepEqual(request.reasoning,{enabled:false});
  assert.equal("reasoning_effort" in request,false);
  assert.equal(request.max_completion_tokens,6200);
 }finally{globalThis.fetch=oldFetch;}
});

test("invalid model JSON is never accepted as a real dossier",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="test";
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'inventato'}}]}),
   {status:200,headers:{"Content-Type":"application/json"}});
 try{
   await assert.rejects(()=>modelStructuredJson("a","b",z.object({summary:z.string()})),/JSON non valido/);
 }finally{
   globalThis.fetch=oldFetch;
   if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
   else process.env.OPENROUTER_API_KEY=oldKey;
 }
});
