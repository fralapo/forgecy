import assert from "node:assert/strict";
import {test} from "node:test";
import {summarizeInstagram,type ObservedSnapshot} from "../../lib/social-analytics";

const observations:ObservedSnapshot[]=[
 {id:"a2",account_id:"a",collected_at:"2026-10-12T12:00:00Z",period:"latest_50_posts",
  data:{measured:true,account:{followers_count:120,media_count:20},media:[
    {id:"post1",like_count:10,comments_count:2,insights:{reach:80,saved:4}},
    {id:"post2",like_count:20,comments_count:1},
    {id:"post3"}]}},
 {id:"b1",account_id:"b",collected_at:"2026-10-11T10:00:00Z",period:"latest_50_posts",
  data:{measured:true,account:{followers_count:900},media:[{id:"outside",like_count:999,comments_count:999}]}},
 {id:"a1",account_id:"a",collected_at:"2026-10-10T10:00:00Z",period:"latest_50_posts",
  data:{measured:true,account:{followers_count:110},media:[]}}
];

test("compare only real snapshots of the same social account",()=>{
 const sum=summarizeInstagram(observations,"a");
 assert.equal(sum.followers,120);
 assert.equal(sum.delta,10);
 assert.equal(sum.previous?.id,"a1");
 assert.equal(sum.total_sampled_interactions,33);
 assert.equal(sum.sampled_posts_with_interactions,2);
 assert.equal(sum.average_interactions,16.5);
 assert.equal(sum.top[0].id,"post2");
 assert.equal(sum.sampled_posts_with_reach,1);
 assert.equal(sum.history.length,2);
 assert.ok(!sum.top.some(x=>x.id==="outside"));
});
test("never substitute missing metrics with a synthetic zero",()=>{
 const sum=summarizeInstagram([{id:"a",account_id:"a",collected_at:"2026-10-12",
 period:"latest_50_posts",data:{measured:true,account:{},media:[{id:"p1"}]}}]);
 assert.equal(sum.followers,null);
 assert.equal(sum.delta,null);
 assert.equal(sum.total_sampled_interactions,null);
 assert.equal(sum.top.length,0);
});
test("unmeasured snapshots cannot contaminate the real dashboard",()=>{
 const sum=summarizeInstagram([...observations,{
 id:"demo",account_id:"a",collected_at:"2026-10-13T00:00:00Z",period:"test",
 data:{measured:false,account:{followers_count:100000}}
 }],"a");
 assert.equal(sum.followers,120);
});
