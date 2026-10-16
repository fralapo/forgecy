import assert from "node:assert/strict";
import {test} from "node:test";
import {createSignedUrlCache} from "../../lib/signed-url-cache";

test("parallel previews share one signed URL request",async()=>{
 let calls=0;
 const cache=createSignedUrlCache();
 let resolve!: (value:string)=>void;
 const load=()=>{calls++;return new Promise<string>(done=>{resolve=done})};
 const first=cache.get("client:bucket:path",load);
 const second=cache.get("client:bucket:path",load);
 assert.equal(calls,1);
 resolve("/signed/file");
 assert.deepEqual(await Promise.all([first,second]),["/signed/file","/signed/file"]);
 assert.equal(await cache.get("client:bucket:path",load),"/signed/file");
 assert.equal(calls,1);
});

test("signed URLs are refreshed before their token can expire",async()=>{
 let time=1_000,calls=0;
 const cache=createSignedUrlCache(30_000,()=>time);
 const load=async()=>`/signed/${++calls}`;
 assert.equal(await cache.get("asset",load),"/signed/1");
 time=27_000;
 assert.equal(await cache.get("asset",load),"/signed/2");
 assert.equal(calls,2);
});

test("signed URL cache bounds entries and evicts the least recently used",async()=>{
 let calls=0;
 const cache=createSignedUrlCache(90_000,Date.now,2);
 const load=async()=>String(++calls);
 await cache.get("a",load);
 await cache.get("b",load);
 await cache.get("a",load);
 await cache.get("c",load);
 assert.equal(await cache.get("a",load),"1");
 assert.equal(await cache.get("b",load),"4");
});
