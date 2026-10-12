import assert from "node:assert/strict";
import {test} from "node:test";
import {JobLeaseLost,runWithJobLease} from "../../lib/job-lease";

test("a valid worker renews its lease before and during protected work",async()=>{
  let renewals=0;
  const output=await runWithJobLease(async()=>{
    renewals++;
    return true;
  },async checkpoint=>{
    await checkpoint();
    return {ok:true};
  },1000);
  assert.deepEqual(output,{ok:true});
  assert.ok(renewals>=3);
});

test("a stale token fails before executing any action",async()=>{
  let ran=false;
  await assert.rejects(
    ()=>runWithJobLease(async()=>false,async()=>{ran=true;},1000),
    JobLeaseLost
  );
  assert.equal(ran,false);
});

test("a lost lease prevents a successful result after work returns",async()=>{
  let renewals=0;
  await assert.rejects(()=>runWithJobLease(async()=>++renewals<2,
    async()=>42,1000),JobLeaseLost);
  assert.equal(renewals,2);
});

test("a periodic heartbeat detects ownership loss during a long job",async()=>{
  let count=0;
  let unblock!:()=>void;
  const latch=new Promise<void>(r=>{unblock=r;});
  const promise=runWithJobLease(async()=>{
    count++;
    if(count===2)unblock();
    return count<2;
  },async checkpoint=>{
    await latch;
    await checkpoint();
  },3);
  await assert.rejects(promise,JobLeaseLost);
  assert.ok(count>=2);
});

test("a rejected DB heartbeat never reports success",async()=>{
  await assert.rejects(
    ()=>runWithJobLease(async()=>{throw new Error("database unavailable");},
      async()=>true,1000),
    JobLeaseLost
  );
});
