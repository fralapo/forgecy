import assert from "node:assert/strict";
import {test} from "node:test";
import {resolvedLayout,layoutStyle,slidePreflight} from "../../lib/carousel-layout";

test("invalid template values fall back to safe content layout",()=>{
 assert.equal(resolvedLayout("unknown"),"content");
 assert.equal(resolvedLayout("__proto__"),"content");
 assert.equal(resolvedLayout("cover"),"cover");
 assert.equal(layoutStyle("quote").textAlign,"center");
});
test("preflight finds important text fit issues without fabricating a quality score",()=>{
 assert.deepEqual(slidePreflight({headline:""}),[{severity:"blocking",message:"La slide non ha un titolo."}]);
 assert.ok(slidePreflight({headline:"T".repeat(120),body:"B".repeat(500)}).length>=2);
 assert.equal(slidePreflight({layout:"cover",headline:"Titolo breve"}).length,0);
});
