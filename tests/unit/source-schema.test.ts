import assert from "node:assert/strict";
import test from "node:test";
import { sourceSchema } from "../../lib/schemas";

test("source schema rejects empty notes and empty website/social references",()=>{
  for(const kind of ["note","website","social"] as const){
    const result=sourceSchema.safeParse({kind,title:"Nuova fonte"});
    assert.equal(result.success,false,`${kind} without evidence must be rejected`);
    if(!result.success)assert.equal(result.error.issues[0].path[0],"body");
  }
});

test("source schema accepts notes with text and references with a URL or annotations",()=>{
  assert.equal(sourceSchema.safeParse({kind:"note",title:"Brief",body:"Obiettivo: richieste di informazioni"}).success,true);
  assert.equal(sourceSchema.safeParse({kind:"website",title:"Sito",url:"https://example.com"}).success,true);
  assert.equal(sourceSchema.safeParse({kind:"social",title:"Instagram",body:"Profilo del brand"}).success,true);
});

test("uploaded documents may remain empty while OCR is pending",()=>{
  assert.equal(sourceSchema.safeParse({kind:"document",title:"Scansione in attesa"}).success,true);
});
