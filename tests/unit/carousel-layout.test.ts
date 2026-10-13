import assert from "node:assert/strict";
import {test} from "node:test";
import {resolvedLayout,layoutStyle,slidePreflight,slideHistoryReducer} from "../../lib/carousel-layout";

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

test("carousel editor history supports undo, redo and server-revision reset",()=>{
 const start={past:[],present:[{headline:"Primo",body:"Descrizione",layout:"content" as const}],future:[]};
 const change={type:"edit" as const,slides:[{headline:"Secondo",body:"Descrizione",layout:"cover" as const}]};
 const edited=slideHistoryReducer(start,change);
 const undone=slideHistoryReducer(edited,{type:"undo"});
 assert.equal(undone.present[0].headline,"Primo");
 const redone=slideHistoryReducer(undone,{type:"redo"});
 assert.equal(redone.present[0].layout,"cover");
 const reset=slideHistoryReducer(redone,{type:"reset",slides:start.present});
 assert.equal(reset.past.length,0);
 assert.equal(reset.future.length,0);
});
