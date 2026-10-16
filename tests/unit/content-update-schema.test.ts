import assert from "node:assert/strict";
import {test} from "node:test";
import {updateContentSchema} from "../../lib/schemas";

const offerId="03299f4d-a3fb-4127-ae0c-3f40cec9ecbc";

test("content updates can explicitly select or clear a linked offer",()=>{
 assert.deepEqual(updateContentSchema.parse({offer_id:offerId}),{offer_id:offerId});
 assert.deepEqual(updateContentSchema.parse({offer_id:null}),{offer_id:null});
 assert.equal(updateContentSchema.safeParse({offer_id:"not-a-uuid"}).success,false);
});
