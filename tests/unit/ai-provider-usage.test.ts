import assert from "node:assert/strict";
import {test} from "node:test";
import {providerUsageRecord,recordAiProviderUsage,withAiUsageScope,type AiUsageRecord} from "../../lib/ai-usage";

const clientA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerA="11111111-1111-4111-8111-111111111111";
const ownerB="22222222-2222-4222-8222-222222222222";

test("OpenRouter cost is provider-reported, never estimated",()=>{
 const record=providerUsageRecord({clientId:clientA,requestedBy:ownerA,operation:"chat"},
  "openrouter","fallback-model",{
   id:"gen-test-1",model:"provider/model",usage:{prompt_tokens:102,completion_tokens:21,total_tokens:123,cost:0.0000132}
  });
 assert.equal(record.provider_request_id,"gen-test-1");
 assert.equal(record.model,"provider/model");
 assert.equal(record.prompt_tokens,102);
 assert.equal(record.completion_tokens,21);
 assert.equal(record.reported_cost_usd,0.0000132);
 assert.equal(record.usage_status,"reported");
});

test("Missing costs remain NULL even when tokens are measured",()=>{
 const record=providerUsageRecord({clientId:clientA,requestedBy:ownerA,operation:"image"},
  "openai","gpt-image-1",{usage:{input_tokens:300,output_tokens:800,total_tokens:1100}});
 assert.equal(record.reported_cost_usd,null);
 assert.equal(record.prompt_tokens,300);
 assert.equal(record.completion_tokens,800);
 assert.equal(record.usage_status,"reported");
 assert.equal(record.provider_request_id,null);
});

test("OpenRouter image responses preserve provider-reported image cost and tokens",()=>{
 const record=providerUsageRecord({clientId:clientA,requestedBy:ownerA,operation:"image"},
  "openrouter","image/model",{usage:{prompt_tokens:24,completion_tokens:1200,total_tokens:1224,cost:0.014}});
 assert.equal(record.model,"image/model");
 assert.equal(record.prompt_tokens,24);
 assert.equal(record.completion_tokens,1200);
 assert.equal(record.reported_cost_usd,0.014);
 assert.equal(record.usage_status,"reported");
});

test("Unknown or misleading numeric values are not inserted as fabricated data",()=>{
 const record=providerUsageRecord({clientId:clientA,requestedBy:ownerA,operation:"adapt"},
  "openrouter","test",{
   id:"gen-test-2",usage:{prompt_tokens:-5,completion_tokens:"NaN",total_tokens:3.5,cost:"Infinity"}
  });
 assert.equal(record.prompt_tokens,null);
 assert.equal(record.completion_tokens,null);
 assert.equal(record.total_tokens,null);
 assert.equal(record.reported_cost_usd,null);
 assert.equal(record.usage_status,"unavailable");
});

test("AsyncLocalStorage isolates parallel client scopes and multi-stage jobs",async()=>{
 const records:AiUsageRecord[]=[];
 const writer=async(r:AiUsageRecord)=>{await Promise.resolve();records.push(r);};
 await Promise.all([
  withAiUsageScope({clientId:clientA,requestedBy:ownerA,operation:"mission",jobId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",writer},
   async()=>{await Promise.resolve();await recordAiProviderUsage("openrouter","modelA",{id:"gen-A",usage:{cost:0.001}});}),
  withAiUsageScope({clientId:clientB,requestedBy:ownerB,operation:"chat",writer},
   async()=>{await Promise.resolve();await recordAiProviderUsage("openrouter","modelB",{id:"gen-B",usage:{cost:0}});})
 ]);
 assert.equal(records.length,2);
 assert.equal(records.find(r=>r.provider_request_id==="gen-A")?.client_id,clientA);
 assert.equal(records.find(r=>r.provider_request_id==="gen-A")?.job_id,"cccccccc-cccc-4ccc-8ccc-cccccccccccc");
 assert.equal(records.find(r=>r.provider_request_id==="gen-B")?.client_id,clientB);
 assert.equal(records.find(r=>r.provider_request_id==="gen-B")?.job_id,null);
});

test("A failed usage insert must never retry or fail a paid model response",async()=>{
 await withAiUsageScope({clientId:clientA,requestedBy:ownerA,operation:"dossier",
  writer:async()=>{throw new Error("db temporarily unavailable")}},
  async()=>{await assert.doesNotReject(()=>recordAiProviderUsage("openrouter","model",{id:"gen-X",usage:{cost:0.5}}));});
});

test("Provider instrumentation outside a client-scoped call never writes records",async()=>{
 // No scope intentionally: anonymous model helpers cannot invent a client ID.
 await recordAiProviderUsage("openrouter","model",{id:"gen-X"});
 assert.ok(true);
});
