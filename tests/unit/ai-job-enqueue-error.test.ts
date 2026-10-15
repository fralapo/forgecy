import test from "node:test";
import assert from "node:assert/strict";
import {mapAiJobEnqueueError} from "../../lib/ai-job-enqueue-error";

test("AI job enqueue reports the temporary request quota",()=>{
  assert.deepEqual(mapAiJobEnqueueError({code:"P0429",message:"Limite frequenza o giornaliero AI raggiunto"}),{
    status:429,
    message:"Hai raggiunto il limite temporaneo di richieste AI per questo cliente o per il workspace. Riprova più tardi."
  });
});

test("AI job enqueue reports the daily job quota",()=>{
  assert.equal(mapAiJobEnqueueError({code:"P0429",message:"Limite lavori AI raggiunto"}).message,
    "Hai raggiunto il limite giornaliero di lavori AI per questo cliente. Riprova più tardi.");
});

test("AI job enqueue hides unexpected database details",()=>{
  assert.deepEqual(mapAiJobEnqueueError({code:"SQLITE_BUSY",message:"private database detail"}),{
    status:503,
    message:"La coda AI non è disponibile in questo momento. Controlla lo stato locale e riprova."
  });
});
