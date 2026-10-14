import assert from "node:assert/strict";
import {test} from "node:test";
import {z} from "zod";
import {modelStructuredJson} from "../../lib/ai";

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

test("invalid model JSON is never accepted as a real dossier",async()=>{
 const oldKey=process.env.OPENROUTER_API_KEY;
 const oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY="test";
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'inventato'}}]}),
   {status:200,headers:{"Content-Type":"application/json"}});
 try{
   await assert.rejects(()=>modelStructuredJson("a","b",z.object({summary:z.string()})),/non JSON/);
 }finally{
   globalThis.fetch=oldFetch;
   if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;
   else process.env.OPENROUTER_API_KEY=oldKey;
 }
});
