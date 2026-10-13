import assert from "node:assert/strict";
import {test} from "node:test";
import {parseInsights} from "../../lib/instagram-insights";

test("Meta insights parser reads only provided numeric metrics",()=>{
 const parsed=parseInsights({data:[
  {name:"reach",values:[{value:120}]},
  {name:"saved",total_value:{value:7}},
  {name:"shares",values:[]},
  {name:"views",values:[{value:-1}]}
 ]});
 assert.deepEqual(parsed,{reach:120,saved:7});
});
test("empty Meta permissions / unavailable data are not zero",()=>{
 assert.deepEqual(parseInsights({error:{message:"permission denied"}}),{});
 assert.deepEqual(parseInsights({data:[]}),{});
});
