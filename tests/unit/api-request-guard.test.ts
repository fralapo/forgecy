import {test} from "node:test";
import assert from "node:assert/strict";
import {z} from "zod";
import {guardApiMutation} from "../../lib/request-guard";
import {read,ApiFailure,MAX_JSON_BODY_BYTES} from "../../lib/http";

function request(method:string,origin?:string,fetchSite?:string,url="https://forgecy.example/api/workspace/clients"){
 const headers=new Headers();
 if(origin!==undefined)headers.set("origin",origin);
 if(fetchSite!==undefined)headers.set("sec-fetch-site",fetchSite);
 return {method,url,headers};
}
test("authenticated API mutations require the exact origin, not just same-site",()=>{
 const accepted=guardApiMutation(request("POST","https://forgecy.example","same-origin"),{
   appOrigin:"https://forgecy.example",production:true
 });
 assert.equal(accepted.ok,true);
 for(const origin of ["https://attacker.example","https://app.forgecy.example",
   "null","http://forgecy.example","https://forgecy.example.evil"]){
   const result=guardApiMutation(request("POST",origin),{appOrigin:"https://forgecy.example",production:true});
   assert.equal(result.ok,false,origin);
   if(!result.ok)assert.equal(result.status,403);
 }
 assert.equal(guardApiMutation(request("POST",undefined),{appOrigin:"https://forgecy.example"}).ok,false);
 assert.equal(guardApiMutation(request("DELETE","https://forgecy.example","cross-site"),{
   appOrigin:"https://forgecy.example"
 }).ok,false);
 assert.equal(guardApiMutation(request("PATCH","https://forgecy.example","same-site"),{
   appOrigin:"https://forgecy.example"
 }).ok,false);
});
test("only API writes are origin gated; production requires a configured host",()=>{
 assert.equal(guardApiMutation(request("GET","https://evil.example"),{production:true}).ok,true);
 assert.equal(guardApiMutation(request("POST",undefined,undefined,"https://forgecy.example/workspace"),{
   production:true
 }).ok,true);
 const missing=guardApiMutation(request("POST","https://forgecy.example"),{production:true});
 assert.equal(missing.ok,false);
 if(!missing.ok)assert.equal(missing.status,503);
 assert.equal(guardApiMutation(request("POST","http://forgecy.example"),{
   production:true,appOrigin:"http://forgecy.example"
 }).ok,false);
 assert.equal(guardApiMutation(request("POST","http://localhost:3000",undefined,"http://localhost:3000/api/test"),{
   production:true,appOrigin:"http://localhost:3000"
 }).ok,true);
});
test("valid small JSON requests still pass Zod validation",async()=>{
 const payload=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"application/json; charset=utf-8"},
   body:JSON.stringify({name:"Studio"})
 });
 const validated=await read(payload,z.object({name:z.string().min(2)}));
 assert.equal(validated.name,"Studio");
});
test("JSON without Content-Length is bounded by actual streamed bytes",async()=>{
 const req=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({value:"x".repeat(MAX_JSON_BODY_BYTES+10)})
 });
 req.headers.delete("content-length");
 await assert.rejects(()=>read(req,z.object({value:z.string()})),
   (e:unknown)=>e instanceof ApiFailure&&e.status===413);
});
test("lying Content-Length cannot bypass streamed body limit",async()=>{
 const req=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({value:"y".repeat(MAX_JSON_BODY_BYTES+20)})
 });
 req.headers.set("content-length","12");
 await assert.rejects(()=>read(req,z.object({value:z.string()})),
   (e:unknown)=>e instanceof ApiFailure&&e.status===413);
});
test("JSON accepts neither form content, malformed JSON nor UTF-8 corruption",async()=>{
 const form=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"text/plain"},body:"{}"
 });
 await assert.rejects(()=>read(form,z.unknown()),
   (e:unknown)=>e instanceof ApiFailure&&e.status===415);
 const bad=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"application/json"},body:"{broken}"
 });
 await assert.rejects(()=>read(bad,z.unknown()),
   (e:unknown)=>e instanceof ApiFailure&&e.status===400);
 const invalid=new Request("https://forgecy.example/api/test",{
   method:"POST",headers:{"content-type":"application/json"},
   body:new Uint8Array([0xff,0xfe,0x7b,0x7d]) as unknown as BodyInit
 });
 await assert.rejects(()=>read(invalid,z.unknown()),
   (e:unknown)=>e instanceof ApiFailure&&e.status===400);
});
