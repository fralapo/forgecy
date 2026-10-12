import assert from "node:assert/strict";
import {test} from "node:test";
import {creativeWarnings,slideVisualSpec,slideHistoryReducer,resolveSlideLayout} from "../../lib/creative-templates";

test("creative layouts keep stable channel-safe dimensions",()=>{
 assert.equal(slideVisualSpec("editorial","instagram").width,1080);
 assert.equal(slideVisualSpec("split","linkedin").height,1080);
 assert.equal(slideVisualSpec("statement","instagram").titleAlign,"center");
 assert.equal(resolveSlideLayout("untrusted"),"classic");
 assert.ok(slideVisualSpec("classic","instagram",120).titlePx<
           slideVisualSpec("classic","instagram",30).titlePx);
});

test("static copy preflight blocks empty and excessively dense slides without inventing visuals",()=>{
 const warnings=creativeWarnings([
  {headline:"",body:""},
  {headline:"Esempio",body:"X".repeat(800),layout:"statement"}
 ],"instagram");
 assert.ok(warnings.some(x=>x.index===0&&x.code==="empty_headline"&&x.severity==="blocking"));
 assert.ok(warnings.some(x=>x.index===1&&x.code==="body_oversized"&&x.severity==="blocking"));
 assert.ok(!warnings.some(x=>x.code==="empty_image"));
});

test("undo redo edits and reset on new persisted revision",()=>{
 const first=[{headline:"Prima",body:"Test"}];
 const second=[{headline:"Seconda",body:"Test"}];
 const start={past:[],present:first,future:[]};
 const updated=slideHistoryReducer(start,{type:"edit",slides:second});
 const undo=slideHistoryReducer(updated,{type:"undo"});
 assert.deepEqual(undo.present,first);
 const redo=slideHistoryReducer(undo,{type:"redo"});
 assert.deepEqual(redo.present,second);
 const reset=slideHistoryReducer(redo,{type:"reset",slides:first});
 assert.equal(reset.past.length,0);assert.equal(reset.future.length,0);
});
