import assert from "node:assert/strict";
import {test} from "node:test";
import {evidenceQuery} from "../../lib/knowledge-retrieval";
test("Italian and English queries keep meaningful evidence search terms",()=>{
 const it=evidenceQuery("Cosa sappiamo dei servizi e dei prodotti dell'azienda?");
 assert.ok(it.includes("servizi"));
 assert.ok(it.includes("prodotti"));
 assert.ok(!it.includes("azienda"));
 const en=evidenceQuery("What does the brand offer about sustainability and packaging?");
 assert.ok(en.includes("sustainability"));
 assert.ok(en.includes("packaging"));
});
test("retrieval query budget bounds untrusted input",()=>{
 const query=evidenceQuery("ripetizione-".repeat(150)+"brand");
 assert.ok(query.length<=160);
 assert.equal(evidenceQuery("come cosa di?"),"");
});
