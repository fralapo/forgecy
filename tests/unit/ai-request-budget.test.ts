import assert from "node:assert/strict";
import {test} from "node:test";
import type {Context} from "../../lib/http";
import {ApiFailure} from "../../lib/http";
import {reserveAiRequest,AI_REQUEST_KINDS} from "../../lib/ai-request-budget";

function context(rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:string|null;error:{code:string;message:string}|null}>):Context{
 return {db:{rpc}} as unknown as Context;
}

test("supported AI request types are an explicit allowlist",()=>{
 assert.deepEqual([...AI_REQUEST_KINDS].sort(),["adapt","chat","dossier","image","mission","strategy"]);
});

test("request reservation is scoped to a client and a known action only",async()=>{
 const clientId="11111111-1111-4111-8111-111111111111";
 let args:Record<string,unknown>={};
 const ctx=context(async(name,payload)=>{
   assert.equal(name,"forgecy_reserve_ai_request");
   args=payload;
   return {data:"22222222-2222-4222-8222-222222222222",error:null};
 });
 assert.equal(await reserveAiRequest(ctx,clientId,"chat"),"22222222-2222-4222-8222-222222222222");
 assert.deepEqual(args,{p_client_id:clientId,p_kind:"chat"});
});

test("shared SQL rate limit is mapped to 429 without exposing internals",async()=>{
 const ctx=context(async()=>({data:null,error:{code:"P0429",message:"sensitive policy details"}}));
 await assert.rejects(()=>reserveAiRequest(ctx,"id","image"),(err:unknown)=>
   err instanceof ApiFailure&&err.status===429&&!err.message.includes("sensitive"));
});

test("unexpected SQL errors and missing reservations are fail-closed",async()=>{
 for(const outcome of [
   {data:null,error:{code:"42501",message:"secret SQL"}}, {data:null,error:null}
 ]){
   const ctx=context(async()=>outcome);
   await assert.rejects(()=>reserveAiRequest(ctx,"id","chat"),(err:unknown)=>
     err instanceof ApiFailure&&err.status===503&&!err.message.includes("secret"));
 }
});

test("unsupported action never calls a database RPC",async()=>{
 const ctx=context(async()=>{throw new Error("RPC must not be called")});
 await assert.rejects(()=>reserveAiRequest(ctx,"id","surprise" as "chat"),(err:unknown)=>
   err instanceof ApiFailure&&err.status===400);
});
