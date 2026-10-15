import test from "node:test";
import assert from "node:assert/strict";
import {mapAiJobEnqueueError} from "../../lib/ai-job-enqueue-error";

test("AI job enqueue hides unexpected database details",()=>{
  assert.deepEqual(mapAiJobEnqueueError({code:"SQLITE_BUSY",message:"private database detail"}),{
    status:503,
    message:"La coda AI non è disponibile in questo momento. Controlla lo stato locale e riprova."
  });
});
