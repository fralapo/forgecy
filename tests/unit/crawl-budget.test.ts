import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "../../lib/http";
import { ApiFailure } from "../../lib/http";
import { requireWebsiteCrawlingEnabled, reserveWebsiteCrawl } from "../../lib/crawl-budget";

function fakeContext(
  rpc: (name:string, args:Record<string,unknown>)=>Promise<{data:string|null;error:null|{code:string;message:string}}>
):Context {
  return {db:{rpc}} as unknown as Context;
}

test("ingestion remains opt-in and unavailable when server egress is not explicitly enabled",()=>{
  assert.throws(()=>requireWebsiteCrawlingEnabled("false"),(e:unknown)=>
    e instanceof ApiFailure && e.status===503);
  assert.throws(()=>requireWebsiteCrawlingEnabled(undefined),(e:unknown)=>
    e instanceof ApiFailure && e.status===503);
  assert.doesNotThrow(()=>requireWebsiteCrawlingEnabled("true"));
});

test("website crawl reservation passes only client ID, hostname and bounded page count to the local operation",async()=>{
  let args:Record<string,unknown>={};
  const ctx=fakeContext(async(name,payload)=>{
    assert.equal(name,"forgecy_reserve_website_crawl");
    args=payload;
    return {data:"123e4567-e89b-42d3-a456-426614174000",error:null};
  });
  const id=await reserveWebsiteCrawl(ctx,"123e4567-e89b-42d3-a456-426614174001","example.com",5);
  assert.equal(id,"123e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(args,{
    p_client_id:"123e4567-e89b-42d3-a456-426614174001",
    p_hostname:"example.com",p_page_budget:5
  });
});

test("local quota errors map to HTTP 429 without exposing internal messages",async()=>{
  const ctx=fakeContext(async()=>({data:null,error:{code:"P0429",message:"private sql error"}}));
  await assert.rejects(()=>reserveWebsiteCrawl(ctx,"id","example.com",1),(e:unknown)=>
    e instanceof ApiFailure && e.status===429 && !e.message.includes("private"));
});

test("unexpected database errors fail closed and never start an unbudgeted crawl",async()=>{
  const ctx=fakeContext(async()=>({data:null,error:{code:"42501",message:"sensitive database details"}}));
  await assert.rejects(()=>reserveWebsiteCrawl(ctx,"id","example.com",1),(e:unknown)=>
    e instanceof ApiFailure && e.status===503 && !e.message.includes("sensitive"));
  const nullResult=fakeContext(async()=>({data:null,error:null}));
  await assert.rejects(()=>reserveWebsiteCrawl(nullResult,"id","example.com",1),(e:unknown)=>
    e instanceof ApiFailure && e.status===503);
});
