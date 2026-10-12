import assert from "node:assert/strict";
import {test} from "node:test";
import {nextFailure} from "../../lib/job-runner";

test("job retry uses exponential delay and stops at max attempts",()=>{
  const first=nextFailure({attempts:1,max_attempts:3},false,0);
  assert.equal(first.retry,true);
  assert.equal(first.run_after,"1970-01-01T00:01:00.000Z");
  const second=nextFailure({attempts:2,max_attempts:3},false,0);
  assert.equal(second.run_after,"1970-01-01T00:02:00.000Z");
  assert.equal(nextFailure({attempts:3,max_attempts:3},false,0).retry,false);
  assert.equal(nextFailure({attempts:1,max_attempts:3},true,0).retry,false);
});
