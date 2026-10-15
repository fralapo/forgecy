import assert from "node:assert/strict";
import {test} from "node:test";
import {offerPatchSchema,offerSchema} from "../../lib/schemas";

test("an offer status-only patch does not add creation defaults",()=>{
 const result=offerPatchSchema.parse({status:"verified"});
 assert.deepEqual(result,{status:"verified"});
});

test("offer patch still validates explicitly supplied fields",()=>{
 assert.deepEqual(offerPatchSchema.parse({price:null,benefits:["Formato 50 ml"]}),{
  price:null,benefits:["Formato 50 ml"]
 });
 assert.equal(offerPatchSchema.safeParse({price:-1}).success,false);
 assert.equal(offerPatchSchema.safeParse({}).success,false);
});

test("offer creation keeps its defaults",()=>{
 const result=offerSchema.parse({kind:"product",name:"Crema test"});
 assert.equal(result.description,"");
 assert.equal(result.price,null);
 assert.deepEqual(result.benefits,[]);
});
